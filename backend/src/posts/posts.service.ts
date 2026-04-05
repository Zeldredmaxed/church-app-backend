import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { rlsStorage } from '../common/storage/rls.storage';
import { Post } from './entities/post.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';
import { GlobalPostJob } from '../feed/social-fanout.processor';

export interface PostWithMeta {
  id: string;
  tenantId: string;
  authorId: string;
  content: string;
  mediaType: string;
  mediaUrl: string | null;
  videoMuxPlaybackId: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string; fullName: string | null; avatarUrl: string | null } | null;
  likeCount: number;
  commentCount: number;
  isLikedByMe: boolean;
  isSavedByMe: boolean;
}

export interface PaginatedPosts {
  posts: PostWithMeta[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue<NotificationJobData>,
    @InjectQueue('social-fanout') private readonly socialFanoutQueue: Queue<GlobalPostJob>,
  ) {}

  /**
   * Creates a new church-internal post.
   *
   * Security guarantees (defence-in-depth):
   *   1. tenantId is set from the RLS context (JWT current_tenant_id) — never from user input.
   *   2. authorId is set from the verified JWT sub — never from user input.
   *   3. The RLS INSERT policy re-validates both at the database level.
   */
  async createPost(dto: CreatePostDto, authorId: string): Promise<Post> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException(
        'No active tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    const post = queryRunner.manager.create(Post, {
      tenantId: currentTenantId,
      authorId,
      content: dto.content,
      mediaType: dto.mediaType ?? (dto.videoMuxPlaybackId ? 'video' : 'text'),
      mediaUrl: dto.mediaUrl ?? null,
      videoMuxPlaybackId: dto.videoMuxPlaybackId ?? null,
    });

    const saved = await queryRunner.manager.save(Post, post);
    this.logger.log(`Post created: ${saved.id} in tenant ${currentTenantId} by ${authorId}`);

    // Re-fetch with author relation so the response includes fullName/avatarUrl
    const postWithAuthor = await queryRunner.manager.findOne(Post, {
      where: { id: saved.id },
      relations: ['author'],
    });

    // Dispatch async mention notifications via BullMQ.
    // Each mentioned user gets a separate job — failures are isolated.
    if (dto.mentions?.length) {
      const uniqueMentions = [...new Set(dto.mentions)];
      for (const mentionedUserId of uniqueMentions) {
        await this.notificationsQueue.add('POST_MENTION', {
          type: NotificationType.POST_MENTION,
          tenantId: currentTenantId,
          recipientUserId: mentionedUserId,
          actorUserId: authorId,
          postId: saved.id,
          previewText: dto.content.slice(0, 100),
        });
      }
      this.logger.log(`Enqueued ${uniqueMentions.length} mention notification(s) for post ${saved.id}`);
    }

    return postWithAuthor ?? saved;
  }

  /**
   * Creates a global post (tenant_id = NULL).
   * Global posts are visible to all authenticated users and are distributed
   * to followers via the fan-out-on-write pattern (BullMQ social-fanout queue).
   *
   * Uses the DataSource directly (service role) because:
   *   1. Global posts have no tenant context — RLS tenant_id check doesn't apply.
   *   2. The "posts: insert global post" RLS policy allows INSERT where
   *      tenant_id IS NULL AND author_id = auth.uid().
   *   3. Using service role here is simpler; the author_id is still derived
   *      from the verified JWT, so impersonation is impossible.
   */
  async createGlobalPost(dto: CreatePostDto, authorId: string, dataSource: import('typeorm').DataSource): Promise<Post> {
    const post = dataSource.manager.create(Post, {
      tenantId: undefined, // NULL — global post
      authorId,
      content: dto.content,
      mediaType: dto.videoMuxPlaybackId ? 'video' : 'text',
      mediaUrl: null,
      videoMuxPlaybackId: dto.videoMuxPlaybackId ?? null,
    });

    const saved = await dataSource.manager.save(Post, post);
    this.logger.log(`Global post created: ${saved.id} by ${authorId}`);

    // Re-fetch with author relation
    const postWithAuthor = await dataSource.manager.findOne(Post, {
      where: { id: saved.id },
      relations: ['author'],
    });

    // Dispatch fan-out job — pushes post ID to all followers' Redis feed lists
    await this.socialFanoutQueue.add('NEW_GLOBAL_POST', {
      postId: saved.id,
      authorId,
    });

    this.logger.log(`Fan-out job enqueued for global post ${saved.id}`);

    // Dispatch mention notifications (same as tenant posts)
    if (dto.mentions?.length) {
      const uniqueMentions = [...new Set(dto.mentions)];
      for (const mentionedUserId of uniqueMentions) {
        await this.notificationsQueue.add('POST_MENTION', {
          type: NotificationType.POST_MENTION,
          tenantId: '',
          recipientUserId: mentionedUserId,
          actorUserId: authorId,
          postId: saved.id,
          previewText: dto.content.slice(0, 100),
        });
      }
    }

    return postWithAuthor ?? saved;
  }

  /**
   * Returns paginated posts for the authenticated user's current tenant.
   * The RLS SELECT policy filters to current_tenant_id automatically.
   * The compound index idx_posts_tenant_created_desc covers this query.
   */
  async getPosts(query: GetPostsDto, userId: string): Promise<PaginatedPosts> {
    const { queryRunner } = this.getRlsContext();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    // authorId filter is optional — when provided, scope to that author only
    const authorFilter = query.authorId ? `AND p.author_id = $4` : '';
    const params: unknown[] = query.authorId
      ? [userId, limit, offset, query.authorId]
      : [userId, limit, offset];

    const rows: Array<{
      id: string; tenant_id: string; author_id: string; content: string;
      media_type: string; media_url: string | null; video_mux_playback_id: string | null;
      created_at: Date; updated_at: Date;
      u_id: string | null; u_email: string | null; u_full_name: string | null; u_avatar_url: string | null;
      like_count: string; comment_count: string;
      is_liked_by_me: boolean; is_saved_by_me: boolean;
    }> = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id,
         p.created_at, p.updated_at,
         u.id         AS u_id,
         u.email      AS u_email,
         u.full_name  AS u_full_name,
         u.avatar_url AS u_avatar_url,
         (SELECT COUNT(*)::int FROM public.post_likes  WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments    WHERE post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $1) AS is_liked_by_me,
         EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $1) AS is_saved_by_me
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE 1=1 ${authorFilter}
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    );

    const countParams = query.authorId ? [query.authorId] : [];
    const countFilter = query.authorId ? `WHERE author_id = $1` : '';
    const [{ total }]: [{ total: string }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.posts ${countFilter}`,
      countParams,
    );

    const posts: PostWithMeta[] = rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      authorId: r.author_id,
      content: r.content,
      mediaType: r.media_type,
      mediaUrl: r.media_url,
      videoMuxPlaybackId: r.video_mux_playback_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, email: r.u_email!, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
        : null,
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      isLikedByMe: r.is_liked_by_me,
      isSavedByMe: r.is_saved_by_me,
    }));

    return { posts, total: Number(total), limit, offset };
  }

  /**
   * Returns a single post by ID.
   * RLS SELECT policy ensures the post belongs to the caller's current tenant.
   * Returns 404 for both "not found" and "wrong tenant" — prevents post ID enumeration.
   */
  async findOne(postId: string): Promise<Post> {
    const { queryRunner } = this.getRlsContext();

    const post = await queryRunner.manager.findOne(Post, {
      where: { id: postId },
      relations: ['author'],
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  /**
   * Updates a post's content.
   *
   * The RLS UPDATE policy enforces two constraints at the DB level:
   *   USING:      tenant_id = current_tenant_id   (correct tenant)
   *   WITH CHECK: author_id = auth.uid()           (must be the author)
   *
   * If affected === 0 the post either doesn't exist, belongs to another tenant,
   * or the caller is not the author. The error message is intentionally vague
   * to avoid leaking which constraint failed.
   */
  async updatePost(postId: string, dto: UpdatePostDto): Promise<Post> {
    const { queryRunner } = this.getRlsContext();

    if (!dto.content) {
      // Nothing to update — return current state without touching the DB
      return this.findOne(postId);
    }

    const result = await queryRunner.manager.update(
      Post,
      { id: postId },
      { content: dto.content },
    );

    if (result.affected === 0) {
      throw new NotFoundException('Post not found or you do not have permission to edit it');
    }

    return this.findOne(postId);
  }

  /**
   * Deletes a post.
   *
   * The RLS DELETE policy allows either the post author OR a tenant admin to delete.
   * If affected === 0 the post doesn't exist, is in another tenant, or the caller
   * lacks the required role.
   */
  async deletePost(postId: string): Promise<void> {
    const { queryRunner } = this.getRlsContext();

    const result = await queryRunner.manager.delete(Post, { id: postId });

    if (result.affected === 0) {
      throw new NotFoundException('Post not found or you do not have permission to delete it');
    }

    this.logger.log(`Post deleted: ${postId}`);
  }

  /** Idempotent like — silently succeeds if already liked. */
  async likePost(postId: string, userId: string): Promise<void> {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }
    const post = await queryRunner.manager.findOne(Post, { where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    await queryRunner.query(
      `INSERT INTO public.post_likes (post_id, user_id, tenant_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, userId, currentTenantId],
    );
  }

  /** Idempotent unlike — silently succeeds if not liked. */
  async unlikePost(postId: string, userId: string): Promise<void> {
    const { queryRunner } = this.getRlsContext();
    await queryRunner.query(
      `DELETE FROM public.post_likes WHERE post_id = $1 AND user_id = $2`,
      [postId, userId],
    );
  }

  /** Idempotent save — silently succeeds if already saved. */
  async savePost(postId: string, userId: string): Promise<void> {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }
    const post = await queryRunner.manager.findOne(Post, { where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    await queryRunner.query(
      `INSERT INTO public.post_saves (post_id, user_id, tenant_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, userId, currentTenantId],
    );
  }

  /** Idempotent unsave — silently succeeds if not saved. */
  async unsavePost(postId: string, userId: string): Promise<void> {
    const { queryRunner } = this.getRlsContext();
    await queryRunner.query(
      `DELETE FROM public.post_saves WHERE post_id = $1 AND user_id = $2`,
      [postId, userId],
    );
  }

  /**
   * Returns paginated saved/bookmarked posts for the current user.
   * Same response shape as getPosts — every post includes engagement counts
   * and isLikedByMe/isSavedByMe so the frontend can render consistently.
   */
  async getSavedPosts(userId: string, limit: number, offset: number): Promise<PaginatedPosts> {
    const { queryRunner } = this.getRlsContext();

    const rows: Array<{
      id: string; tenant_id: string; author_id: string; content: string;
      media_type: string; media_url: string | null; video_mux_playback_id: string | null;
      created_at: Date; updated_at: Date;
      u_id: string | null; u_email: string | null; u_full_name: string | null; u_avatar_url: string | null;
      like_count: string; comment_count: string;
      is_liked_by_me: boolean; is_saved_by_me: boolean;
    }> = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id,
         p.created_at, p.updated_at,
         u.id         AS u_id,
         u.email      AS u_email,
         u.full_name  AS u_full_name,
         u.avatar_url AS u_avatar_url,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $1) AS is_liked_by_me,
         true AS is_saved_by_me
       FROM public.post_saves ps
       JOIN public.posts p ON p.id = ps.post_id
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE ps.user_id = $1
       ORDER BY ps.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const [{ total }]: [{ total: string }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.post_saves WHERE user_id = $1`,
      [userId],
    );

    const posts: PostWithMeta[] = rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      authorId: r.author_id,
      content: r.content,
      mediaType: r.media_type,
      mediaUrl: r.media_url,
      videoMuxPlaybackId: r.video_mux_playback_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, email: r.u_email!, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
        : null,
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      isLikedByMe: r.is_liked_by_me,
      isSavedByMe: true,
    }));

    return { posts, total: Number(total), limit, offset };
  }

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }
    return context;
  }
}
