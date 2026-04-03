import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private redis: Redis;

  constructor(host: string, port: number, password?: string) {
    this.redis = new Redis({ host, port, password, lazyConnect: true });
    this.redis.connect().catch(() => {});
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    // Check if currently blocked
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
      // First hit — set TTL in seconds
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

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
