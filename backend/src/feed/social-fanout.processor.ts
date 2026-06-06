import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Follow } from '../follows/entities/follow.entity';
import { Post } from '../posts/entities/post.entity';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/** Maximum number of post IDs stored in each user's Redis feed list. */
const MAX_FEED_LENGTH = 500;

export interface GlobalPostJob {
  postId: string;
  authorId: string;
}

/**
 * BullMQ processor for the 'social-fanout' queue.
 *
 * When a global post is created, this worker:
 *   1. Queries the follows table for all followers of the post author.
 *   2. For each follower, prepends the post ID to their Redis feed list
 *      using LPUSH + LTRIM (capped at 500 entries).
 *   3. Optionally dispatches a notification job for each follower.
 *
 * This is the classic "fan-out on write" pattern:
 *   - Write cost: O(followers) at post creation time
 *   - Read cost: O(1) — the feed is pre-computed in Redis
 *   - Trade-off: higher write amplification, but reads are instant
 *
 * Runs outside HTTP lifecycle — uses service-role DataSource.
 */
@Processor('social-fanout')
export class SocialFanoutProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(SocialFanoutProcessor.name);
  private readonly redis: Redis;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {
    super();
    const redisHost = this.config.get<string>('REDIS_HOST', 'localhost');
    this.redis = new Redis({
      host: redisHost,
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD'),
      tls: redisHost.includes('upstash.io') ? {} : undefined,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async process(job: Job<GlobalPostJob>): Promise<void> {
    const { postId, authorId } = job.data;
    this.logger.log(`Fan-out started for post ${postId} by author ${authorId}`);

    // Fetch all followers of the post author
    const followers = await this.dataSource.manager.find(Follow, {
      where: { followingId: authorId },
      select: ['followerId'],
    });

    if (followers.length === 0) {
      this.logger.log(`No followers for author ${authorId} — fan-out skipped`);
      return;
    }

    this.logger.log(`Fanning out post ${postId} to ${followers.length} follower(s)`);

    // Idempotency: BullMQ default = 3 attempts. Without LREM first, a
    // retry of this whole job re-LPUSHes the same postId — so a follower
    // sees the same post twice (or three times) at the top of their
    // feed. LREM is cheap (O(N) scan of one user's bounded 500-item
    // list) and runs in the same pipeline, so the round-trip cost
    // doesn't change.
    const lpushPipeline = this.redis.pipeline();
    for (const { followerId } of followers) {
      const feedKey = `user:${followerId}:feed:global`;
      lpushPipeline.lrem(feedKey, 0, postId);
      lpushPipeline.lpush(feedKey, postId);
      lpushPipeline.ltrim(feedKey, 0, MAX_FEED_LENGTH - 1);
    }
    await lpushPipeline.exec();

    this.logger.log(`Fan-out complete: post ${postId} pushed to ${followers.length} feed(s)`);

    // Fetch post content for the notification preview
    const post = await this.dataSource.manager.findOne(Post, {
      where: { id: postId },
      select: ['content'],
    });
    const previewText = post?.content?.slice(0, 100) ?? '';

    // Per-follower notification idempotency. The processor's dedupe path
    // (notifications.dedupe_key) will silently skip duplicates, but
    // checking here lets us avoid enqueueing 10k jobs that all get
    // discarded on a retry. NX semantics: only succeeds if the key
    // wasn't set in the last 24h.
    const notifyPipeline = this.redis.pipeline();
    const candidates: string[] = [];
    for (const { followerId } of followers) {
      const key = `fanout:notified:${postId}:${followerId}`;
      notifyPipeline.set(key, '1', 'EX', 86400, 'NX');
      candidates.push(followerId);
    }
    const results = await notifyPipeline.exec();

    // ioredis pipeline.exec returns Array<[err, result]> in command order.
    for (let i = 0; i < candidates.length; i++) {
      const result = results?.[i]?.[1];
      if (result !== 'OK') continue; // already notified, skip
      const followerId = candidates[i];
      await this.notificationsQueue.add('NEW_GLOBAL_POST', {
        type: NotificationType.NEW_GLOBAL_POST,
        tenantId: null as any, // Global posts have no tenant
        recipientUserId: followerId,
        actorUserId: authorId,
        postId,
        previewText,
      });
    }
  }
}
