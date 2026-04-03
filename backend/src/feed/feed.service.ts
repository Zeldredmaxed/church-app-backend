import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Post } from '../posts/entities/post.entity';
import { User } from '../users/entities/user.entity';
import { Comment } from '../comments/entities/comment.entity';

/** Represents a post in the feed with resolved author and latest comment. */
export interface FeedPost {
  id: string;
  content: string;
  mediaType: string;
  mediaUrl: string | null;
  videoMuxPlaybackId: string | null;
  createdAt: Date;
  author: { id: string; fullName: string | null; avatarUrl: string | null };
  latestComment: {
    id: string;
    content: string;
    createdAt: Date;
    author: { id: string; fullName: string | null; avatarUrl: string | null };
  } | null;
}

export interface PaginatedFeed {
  posts: FeedPost[];
  /** Total number of items in the user's Redis feed list. */
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private readonly redis: Redis;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    const redisHost = this.config.get<string>('REDIS_HOST', 'localhost');
    this.redis = new Redis({
      host: redisHost,
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD'),
      tls: redisHost.includes('upstash.io') ? {} : undefined,
    });
  }

  /**
   * Returns the authenticated user's global feed.
   *
   * Flow:
   *   1. LRANGE user:{userId}:feed:global to get post IDs from Redis
   *   2. Batch-fetch posts from Postgres using WHERE id IN (...)
   *   3. Batch-resolve authors using a DataLoader-style approach
   *   4. Batch-resolve latest comment per post
   *   5. Preserve the Redis ordering (newest first)
   *
   * Falls back to a DB query for recent global posts if the Redis feed is empty
   * (cold start — user just signed up or follows nobody yet).
   */
  async getGlobalFeed(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<PaginatedFeed> {
    const feedKey = `user:${userId}:feed:global`;

    // Get total feed length + requested page of post IDs from Redis
    const [totalResult, postIds] = await Promise.all([
      this.redis.llen(feedKey),
      this.redis.lrange(feedKey, offset, offset + limit - 1),
    ]);

    const total = totalResult;

    // Cold start fallback: if Redis feed is empty, fetch recent global posts from DB
    if (postIds.length === 0) {
      return this.getColdStartFeed(limit, offset);
    }

    // Batch-fetch posts from Postgres
    const posts = await this.dataSource.manager.find(Post, {
      where: { id: In(postIds) },
    });

    // Preserve Redis ordering
    const postMap = new Map(posts.map(p => [p.id, p]));
    const orderedPosts = postIds
      .map(id => postMap.get(id))
      .filter((p): p is Post => p !== undefined);

    // Batch-resolve authors and latest comments
    const feedPosts = await this.enrichPosts(orderedPosts);

    return { posts: feedPosts, total, limit, offset };
  }

  /**
   * Cold start fallback — returns recent global posts from the DB.
   * Used when a user's Redis feed is empty (new user, follows nobody, etc.).
   */
  private async getColdStartFeed(limit: number, offset: number): Promise<PaginatedFeed> {
    this.logger.log('Cold start: falling back to DB query for global feed');

    const [posts, total] = await this.dataSource.manager.findAndCount(Post, {
      where: { tenantId: undefined }, // TypeORM: undefined maps to IS NULL
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // TypeORM's `undefined` in where clause can be tricky; use QueryBuilder for IS NULL
    const qb = this.dataSource.manager
      .createQueryBuilder(Post, 'p')
      .where('p.tenant_id IS NULL')
      .orderBy('p.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    const [globalPosts, globalTotal] = await qb.getManyAndCount();

    const feedPosts = await this.enrichPosts(globalPosts);
    return { posts: feedPosts, total: globalTotal, limit, offset };
  }

  /**
   * Batch-resolves authors and latest comments for a list of posts.
   * This is the DataLoader-style batch approach that prevents N+1 queries.
   *
   * Instead of: for each post → fetch author → fetch latest comment (N+1)
   * We do: collect all author IDs → one query → collect all post IDs → one query
   */
  private async enrichPosts(posts: Post[]): Promise<FeedPost[]> {
    if (posts.length === 0) return [];

    // 1. Batch-resolve all authors in one query
    const authorIds = [...new Set(posts.map(p => p.authorId))];
    const authors = await this.dataSource.manager
      .createQueryBuilder(User, 'u')
      .select(['u.id', 'u.fullName', 'u.avatarUrl'])
      .where('u.id IN (:...ids)', { ids: authorIds })
      .getMany();
    const authorMap = new Map(authors.map(a => [a.id, a]));

    // 2. Batch-resolve latest comment per post using a lateral join
    //    This gets the single most recent comment for each post in one query.
    const postIds = posts.map(p => p.id);
    const latestComments: Array<{
      post_id: string;
      comment_id: string;
      comment_content: string;
      comment_created_at: Date;
      comment_author_id: string;
    }> = await this.dataSource.query(
      `SELECT DISTINCT ON (c.post_id)
         c.post_id,
         c.id AS comment_id,
         c.content AS comment_content,
         c.created_at AS comment_created_at,
         c.author_id AS comment_author_id
       FROM public.comments c
       WHERE c.post_id = ANY($1)
       ORDER BY c.post_id, c.created_at DESC`,
      [postIds],
    );

    // Resolve comment authors
    const commentAuthorIds = [...new Set(latestComments.map(c => c.comment_author_id))];
    let commentAuthorMap = new Map<string, User>();
    if (commentAuthorIds.length > 0) {
      const commentAuthors = await this.dataSource.manager
        .createQueryBuilder(User, 'u')
        .select(['u.id', 'u.fullName', 'u.avatarUrl'])
        .where('u.id IN (:...ids)', { ids: commentAuthorIds })
        .getMany();
      commentAuthorMap = new Map(commentAuthors.map(a => [a.id, a]));
    }

    const commentMap = new Map(
      latestComments.map(c => [
        c.post_id,
        {
          id: c.comment_id,
          content: c.comment_content,
          createdAt: c.comment_created_at,
          author: (() => {
            const a = commentAuthorMap.get(c.comment_author_id);
            return a
              ? { id: a.id, fullName: a.fullName, avatarUrl: a.avatarUrl }
              : { id: c.comment_author_id, fullName: null, avatarUrl: null };
          })(),
        },
      ]),
    );

    // 3. Assemble feed posts
    return posts.map(p => {
      const author = authorMap.get(p.authorId);
      return {
        id: p.id,
        content: p.content,
        mediaType: p.mediaType,
        mediaUrl: p.mediaUrl,
        videoMuxPlaybackId: p.videoMuxPlaybackId,
        createdAt: p.createdAt,
        author: author
          ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl }
          : { id: p.authorId, fullName: null, avatarUrl: null },
        latestComment: commentMap.get(p.id) ?? null,
      };
    });
  }
}
