import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { Post } from './entities/post.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';
import { GlobalPostJob } from '../feed/social-fanout.processor';
import { AuditService } from '../audit/audit.service';

export interface PostWithMeta {
  id: string;
  tenantId: string;
  authorId: string;
  content: string;
  mediaType: string;
  mediaUrl: string | null;
  videoMuxPlaybackId: string | null;
  visibility: 'public' | 'private';
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; fullName: string | null; avatarUrl: string | null } | null;
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
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
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
      visibility: dto.visibility ?? 'public',
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
  async createGlobalPost(dto: CreatePostDto, authorId: string): Promise<Post> {
    const post = this.dataSource.manager.create(Post, {
      tenantId: undefined as any, // NULL — global post
      authorId,
      content: dto.content,
      mediaType: dto.mediaType ?? (dto.videoMuxPlaybackId ? 'video' : 'text'),
      mediaUrl: dto.mediaUrl ?? null,
      videoMuxPlaybackId: dto.videoMuxPlaybackId ?? null,
      visibility: dto.visibility ?? 'public',
    });

    const saved = await this.dataSource.manager.save(Post, post);
    this.logger.log(`Global post created: ${saved.id} by ${authorId}`);

    // Re-fetch with author relation
    const postWithAuthor = await this.dataSource.manager.findOne(Post, {
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

    // Optional filters. Params slot in after the base [userId, limit, offset].
    const params: unknown[] = [userId, limit, offset];
    let authorFilter = '';
    if (query.authorId) {
      params.push(query.authorId);
      authorFilter = `AND p.author_id = $${params.length}`;
    }
    let mediaTypeFilter = '';
    if (query.mediaType) {
      params.push(query.mediaType);
      mediaTypeFilter = `AND p.media_type = $${params.length}`;
    }

    const rows: Array<{
      id: string; tenant_id: string; author_id: string; content: string;
      media_type: string; media_url: string | null; video_mux_playback_id: string | null;
      visibility: 'public' | 'private';
      created_at: Date; updated_at: Date;
      u_id: string | null; u_full_name: string | null; u_avatar_url: string | null;
      like_count: string; comment_count: string;
      is_liked_by_me: boolean; is_saved_by_me: boolean;
    }> = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.visibility,
         p.created_at, p.updated_at,
         u.id         AS u_id,
         u.full_name  AS u_full_name,
         u.avatar_url AS u_avatar_url,
         lc.like_count,
         cc.comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $1) AS is_liked_by_me,
         EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $1) AS is_saved_by_me
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS like_count FROM public.post_likes WHERE post_id = p.id) lc ON true
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS comment_count FROM public.comments WHERE post_id = p.id) cc ON true
       WHERE p.is_archived = false ${authorFilter} ${mediaTypeFilter}
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    );

    // countParams must only contain values referenced by the SQL —
    // previously userId was bound to $1 (used in author_id = $1) but the
    // visibility-filter removal left it dangling, which Postgres rejects
    // with "could not determine data type of parameter $1".
    const countParams: unknown[] = [];
    let countAuthorFilter = '';
    if (query.authorId) {
      countParams.push(query.authorId);
      countAuthorFilter = `AND author_id = $${countParams.length}`;
    }
    let countMediaTypeFilter = '';
    if (query.mediaType) {
      countParams.push(query.mediaType);
      countMediaTypeFilter = `AND media_type = $${countParams.length}`;
    }
    // Tenant scoping is enforced by RLS on public.posts; no extra filter here.
    // The previous "visibility = 'public' OR author_id = me" filter hid every
    // post the mobile created (it sends visibility='private' by default), so
    // members couldn't see each other's posts. Per-post visibility isn't a
    // shipped product feature — if it comes back, gate it here.
    const [{ total }]: [{ total: string }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.posts
       WHERE is_archived = false ${countAuthorFilter} ${countMediaTypeFilter}`,
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
      visibility: r.visibility,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
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
  async findOne(postId: string, userId: string): Promise<PostWithMeta> {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.visibility,
         p.created_at, p.updated_at,
         u.id         AS u_id,
         u.full_name  AS u_full_name,
         u.avatar_url AS u_avatar_url,
         lc.like_count,
         cc.comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $2) AS is_liked_by_me,
         EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $2) AS is_saved_by_me
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS like_count FROM public.post_likes WHERE post_id = p.id) lc ON true
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS comment_count FROM public.comments WHERE post_id = p.id) cc ON true
       WHERE p.id = $1
         AND (p.is_archived = false OR p.author_id = $2)`,
      [postId, userId],
    );

    if (!rows.length) {
      throw new NotFoundException('Post not found');
    }

    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      authorId: r.author_id,
      content: r.content,
      mediaType: r.media_type,
      mediaUrl: r.media_url,
      videoMuxPlaybackId: r.video_mux_playback_id,
      visibility: r.visibility,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
        : null,
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      isLikedByMe: r.is_liked_by_me,
      isSavedByMe: r.is_saved_by_me,
    };
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
  async updatePost(postId: string, dto: UpdatePostDto, userId: string): Promise<PostWithMeta> {
    const { queryRunner } = this.getRlsContext();

    const updates: Partial<Post> = {};
    if (dto.content !== undefined) updates.content = dto.content;
    if (dto.visibility !== undefined) updates.visibility = dto.visibility;

    if (Object.keys(updates).length === 0) {
      // Nothing to update — return current state without touching the DB
      return this.findOne(postId, userId);
    }

    const result = await queryRunner.manager.update(Post, { id: postId }, updates);

    if (result.affected === 0) {
      throw new NotFoundException('Post not found or you do not have permission to edit it');
    }

    return this.findOne(postId, userId);
  }

  /**
   * Deletes a post.
   *
   * The RLS DELETE policy allows either the post author OR a tenant admin to delete.
   * If affected === 0 the post doesn't exist, is in another tenant, or the caller
   * lacks the required role.
   */
  async deletePost(postId: string): Promise<void> {
    const { queryRunner, userId } = this.getRlsContext();

    // Snapshot the post BEFORE deleting so we can audit who the author was,
    // distinguish self-delete from admin moderation, and capture the content
    // preview for the summary.
    const before = await queryRunner.manager.findOne(Post, { where: { id: postId } });
    if (!before) {
      throw new NotFoundException('Post not found or you do not have permission to delete it');
    }

    const result = await queryRunner.manager.delete(Post, { id: postId });
    if (result.affected === 0) {
      throw new NotFoundException('Post not found or you do not have permission to delete it');
    }

    // Only audit when an admin removes someone else's post — author
    // self-deletes are not admin actions and don't need to clutter the log.
    if (before.authorId !== userId) {
      const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
      const [author] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [before.authorId]);
      await this.audit.log({
        action: 'post.deleted',
        resourceType: 'post',
        resourceId: postId,
        targetUserId: before.authorId,
        summary: `${actor?.full_name ?? 'Admin'} deleted a post by ${author?.full_name ?? 'unknown'}`,
        metadata: {
          authorId: before.authorId,
          contentPreview: (before.content ?? '').slice(0, 200),
          mediaType: before.mediaType,
        },
      });
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
      visibility: 'public' | 'private';
      created_at: Date; updated_at: Date;
      u_id: string | null; u_full_name: string | null; u_avatar_url: string | null;
      like_count: string; comment_count: string;
      is_liked_by_me: boolean;
    }> = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.visibility,
         p.created_at, p.updated_at,
         u.id         AS u_id,
         u.full_name  AS u_full_name,
         u.avatar_url AS u_avatar_url,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $1) AS is_liked_by_me
       FROM public.post_saves ps
       JOIN public.posts p ON p.id = ps.post_id
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE ps.user_id = $1 AND p.is_archived = false
       ORDER BY ps.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    // Same archive filter on the count so the count matches the page contents.
    const [{ total }]: [{ total: string }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.post_saves ps
       JOIN public.posts p ON p.id = ps.post_id
       WHERE ps.user_id = $1 AND p.is_archived = false`,
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
      visibility: r.visibility,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
        : null,
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      isLikedByMe: r.is_liked_by_me,
      isSavedByMe: true,
    }));

    return { posts, total: Number(total), limit, offset };
  }

  /**
   * Toggles is_archived on a post. Author-only — the RLS UPDATE policy
   * already enforces author_id = auth.uid(), so a non-author update affects
   * zero rows. We surface that as 404 to avoid leaking whether the post
   * exists.
   */
  private async setArchived(postId: string, isArchived: boolean): Promise<{ archived: boolean }> {
    const { queryRunner, userId } = this.getRlsContext();
    const result = await queryRunner.query(
      `UPDATE public.posts SET is_archived = $1, updated_at = now()
       WHERE id = $2 RETURNING id, author_id, content`,
      [isArchived, postId],
    );
    if (!result.length) {
      throw new NotFoundException('Post not found');
    }

    // RLS UPDATE policy restricts to author_id = auth.uid(), so this is
    // always a self-archive — author archiving their own content. We
    // still log it for completeness; it's not a high-priority audit
    // signal but useful for "did I archive this?" questions later.
    const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
    await this.audit.log({
      action: isArchived ? 'post.archived' : 'post.unarchived',
      resourceType: 'post',
      resourceId: postId,
      summary: `${actor?.full_name ?? 'Someone'} ${isArchived ? 'archived' : 'unarchived'} their post`,
      metadata: {
        contentPreview: (result[0].content ?? '').slice(0, 200),
      },
    });

    return { archived: isArchived };
  }

  archivePost(postId: string) {
    return this.setArchived(postId, true);
  }

  unarchivePost(postId: string) {
    return this.setArchived(postId, false);
  }

  /**
   * Admin/pastor moderation path — archive someone else's post.
   *
   * The standard archive route (setArchived) goes through RLS, whose
   * UPDATE policy on public.posts pins author_id = auth.uid(). That's the
   * correct guard for self-archive but locks admins out of moderation —
   * they'd have to delete (heavy, destroys content) or do nothing.
   *
   * This method bypasses RLS via the service-role DataSource. The
   * controller layer is responsible for gating the route with
   * @RequiresRole('admin', 'pastor'); we additionally pin the UPDATE to
   * tenant_id = JWT current_tenant_id so the bypass can't leak across
   * tenants. Only is_archived is touched — content/visibility/author
   * stay immutable, satisfying the principle of least privilege.
   */
  async adminArchivePost(postId: string, archived: boolean, reason: string | null): Promise<{ archived: boolean }> {
    const { userId, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }

    const rows: Array<{ id: string; author_id: string; content: string | null; tenant_id: string }> =
      await this.dataSource.query(
        `UPDATE public.posts
         SET is_archived = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3
         RETURNING id, author_id, content, tenant_id`,
        [archived, postId, currentTenantId],
      );

    if (!rows.length) {
      throw new NotFoundException('Post not found');
    }

    const post = rows[0];
    const [actor] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [userId],
    );
    const [author] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [post.author_id],
    );

    await this.audit.log({
      action: archived ? 'post.archived' : 'post.unarchived',
      resourceType: 'post',
      resourceId: postId,
      targetUserId: post.author_id,
      summary: `${actor?.full_name ?? 'Admin'} ${archived ? 'archived' : 'unarchived'} a post by ${author?.full_name ?? 'unknown'}`,
      metadata: {
        byAdmin: true,
        authorId: post.author_id,
        contentPreview: (post.content ?? '').slice(0, 200),
        reason,
      },
    });

    return { archived };
  }

  /**
   * Returns the caller's archived posts. Only the author sees their own
   * archive; this endpoint is implicitly scoped to the caller.
   */
  async getArchivedPosts(userId: string, limit: number, offset: number): Promise<PaginatedPosts> {
    const { queryRunner } = this.getRlsContext();

    const rows: Array<{
      id: string; tenant_id: string; author_id: string; content: string;
      media_type: string; media_url: string | null; video_mux_playback_id: string | null;
      visibility: 'public' | 'private';
      created_at: Date; updated_at: Date;
      u_id: string | null; u_full_name: string | null; u_avatar_url: string | null;
      like_count: string; comment_count: string;
      is_liked_by_me: boolean; is_saved_by_me: boolean;
    }> = await queryRunner.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.visibility,
         p.created_at, p.updated_at,
         u.id AS u_id, u.full_name AS u_full_name, u.avatar_url AS u_avatar_url,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $1) AS is_liked_by_me,
         EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $1) AS is_saved_by_me
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE p.author_id = $1 AND p.is_archived = true
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const [{ total }]: [{ total: string }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.posts
       WHERE author_id = $1 AND is_archived = true`,
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
      visibility: r.visibility,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: r.u_id
        ? { id: r.u_id, fullName: r.u_full_name, avatarUrl: r.u_avatar_url }
        : null,
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
      isLikedByMe: r.is_liked_by_me,
      isSavedByMe: r.is_saved_by_me,
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
