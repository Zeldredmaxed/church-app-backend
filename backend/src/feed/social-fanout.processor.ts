import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Follow } from '../follows/entities/follow.entity';
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
export class SocialFanoutProcessor extends WorkerHost {
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

    // Pipeline Redis commands for efficiency — single round-trip for all followers
    const pipeline = this.redis.pipeline();
    for (const { followerId } of followers) {
      const feedKey = `user:${followerId}:feed:global`;
      pipeline.lpush(feedKey, postId);
      pipeline.ltrim(feedKey, 0, MAX_FEED_LENGTH - 1);
    }
    await pipeline.exec();

    this.logger.log(`Fan-out complete: post ${postId} pushed to ${followers.length} feed(s)`);

    // Dispatch notification jobs for each follower (non-blocking — failures are isolated)
    for (const { followerId } of followers) {
      await this.notificationsQueue.add('NEW_GLOBAL_POST', {
        type: NotificationType.POST_MENTION,
        tenantId: '', // Global posts have no tenant — use empty string
        recipientUserId: followerId,
        actorUserId: authorId,
        postId,
        previewText: '', // Preview will be resolved by the processor from the DB
      });
    }
  }
}
