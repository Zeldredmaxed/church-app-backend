import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis-backed cache for dashboard KPIs and analytics.
 *
 * Dashboard endpoints hit the DB with heavy aggregation queries.
 * Caching these for 30-60 seconds makes repeated loads instant
 * while keeping data near-real-time.
 *
 * Falls back gracefully to no-cache if Redis is unavailable.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('REDIS_HOST');
    if (!host || host.includes('placeholder')) {
      this.logger.warn('REDIS_HOST not configured — cache disabled (all reads miss)');
      return;
    }

    const port = this.config.get<number>('REDIS_PORT', 6379);
    const password = this.config.get<string>('REDIS_PASSWORD');
    const useTls = host.includes('upstash.io');

    this.redis = new Redis({
      host,
      port,
      password: password || undefined,
      tls: useTls ? {} : undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    this.redis.on('error', (err) => {
      this.logger.warn(`Redis cache error: ${err.message}`);
    });

    this.redis.connect().catch(() => {
      this.logger.warn('Redis cache connection failed — operating without cache');
      this.redis = null;
    });
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  /**
   * Get a cached value. Returns null on miss or if Redis is unavailable.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set a cached value with TTL in seconds.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /**
   * Delete a cached key (for cache invalidation).
   */
  async del(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Cache-through helper: returns cached value if available,
   * otherwise calls the factory, caches the result, and returns it.
   */
  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const result = await factory();
    await this.set(key, result, ttlSeconds);
    return result;
  }
}
