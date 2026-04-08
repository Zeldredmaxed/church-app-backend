import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Redis-backed throttler storage with in-memory fallback.
 *
 * If Redis becomes unreachable (connection error, quota exceeded, etc.),
 * the throttler falls back to a simple in-memory Map so the app keeps
 * serving requests instead of returning 500 on every route.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private redis: Redis;
  private healthy = false;

  /** In-memory fallback store: key → { hits, expiresAt } */
  private readonly memoryStore = new Map<string, { hits: number; expiresAt: number }>();

  constructor(host: string, port: number, password?: string) {
    this.redis = new Redis({
      host, port, password, lazyConnect: true,
      tls: host.includes('upstash.io') ? {} : undefined,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 500, 2000);
      },
    });

    this.redis.on('ready', () => {
      this.healthy = true;
      this.logger.log('Redis throttler connected');
    });

    this.redis.on('error', (err) => {
      if (this.healthy) {
        this.logger.warn(`Redis throttler unavailable, falling back to in-memory: ${err.message}`);
      }
      this.healthy = false;
    });

    this.redis.connect().catch(() => {
      this.logger.warn('Redis throttler initial connection failed, using in-memory fallback');
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.healthy) {
      return this.incrementMemory(key, ttl, limit, blockDuration, throttlerName);
    }

    try {
      return await this.incrementRedis(key, ttl, limit, blockDuration, throttlerName);
    } catch (err: any) {
      this.logger.warn(`Redis throttler error, falling back to in-memory: ${err.message}`);
      this.healthy = false;
      return this.incrementMemory(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  private async incrementRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    const blockedTtl = await this.redis.ttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: blockedTtl * 1000,
        isBlocked: true,
        timeToBlockExpire: blockedTtl * 1000,
      };
    }

    const totalHits = await this.redis.incr(redisKey);

    if (totalHits === 1) {
      await this.redis.expire(redisKey, Math.ceil(ttl / 1000));
    }

    const ttlRemaining = await this.redis.ttl(redisKey);

    if (totalHits > limit && blockDuration > 0) {
      await this.redis.set(blockKey, '1', 'EX', Math.ceil(blockDuration / 1000));
      return {
        totalHits,
        timeToExpire: ttlRemaining * 1000,
        isBlocked: true,
        timeToBlockExpire: blockDuration,
      };
    }

    return {
      totalHits,
      timeToExpire: ttlRemaining * 1000,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  private incrementMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ThrottlerStorageRecord {
    const memKey = `${throttlerName}:${key}`;
    const now = Date.now();

    const existing = this.memoryStore.get(memKey);

    if (!existing || existing.expiresAt <= now) {
      this.memoryStore.set(memKey, { hits: 1, expiresAt: now + ttl });
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }

    existing.hits++;
    const timeToExpire = existing.expiresAt - now;

    if (existing.hits > limit && blockDuration > 0) {
      existing.expiresAt = now + blockDuration;
      return {
        totalHits: existing.hits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: blockDuration,
      };
    }

    return {
      totalHits: existing.hits,
      timeToExpire,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
