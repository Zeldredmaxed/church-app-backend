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
import { Comment } from './entities/comment.entity';
import { Post } from '../posts/entities/post.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { GetCommentsDto } from './dto/get-comments.dto';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';

export interface PaginatedComments {
  comments: Comment[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {}

  /**
   * Creates a comment on a post.
   *
   * Security guarantees (defence-in-depth):
   *   1. tenantId is set from the RLS context — never from user input.
   *   2. authorId is set from the verified JWT sub — never from user input.
   *   3. The parent post is verified via an RLS-scoped findOne: if the post
   *      doesn't exist in the current tenant, a 404 is thrown. This prevents
   *      comments being attached to posts from other tenants.
   *   4. The DB trigger validate_comment_tenant provides a final DB-level check
   *      that comment.tenant_id === post.tenant_id regardless of service code.
   *   5. The RLS INSERT policy re-validates tenantId and authorId at write time.
   */
  async createComment(
    postId: string,
    dto: CreateCommentDto,
    authorId: string,
  ): Promise<Comment> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException(
        'No active tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    // Verify parent post exists in the current tenant via RLS-scoped query.
    // If the post belongs to another tenant, RLS returns null here — same 404
    // as "post doesn't exist". Intentional: prevents tenant enumeration.
    const post = await queryRunner.manager.findOne(Post, { where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // At least one of content or mediaUrl must be provided
    const hasContent = dto.content && dto.content.trim().length > 0;
    const hasMedia = dto.mediaUrl && dto.mediaUrl.trim().length > 0;
    if (!hasContent && !hasMedia) {
      throw new BadRequestException('A comment must have either text content or an image attachment.');
    }

    const comment = queryRunner.manager.create(Comment, {
      postId,
      tenantId: currentTenantId,
      authorId,
      content: hasContent ? dto.content!.trim() : null,
      mediaUrl: hasMedia ? dto.mediaUrl! : null,
      parentId: dto.parentId ?? null,
    });

    const saved = await queryRunner.manager.save(Comment, comment);
    this.logger.log(`Comment created: ${saved.id} on post ${postId} by ${authorId}`);

    // Dispatch async notification to the post author via BullMQ.
    // The processor skips self-notifications (author commenting on own post).
    await this.notificationsQueue.add('NEW_COMMENT', {
      type: NotificationType.NEW_COMMENT,
      tenantId: currentTenantId,
      recipientUserId: post.authorId,
      actorUserId: authorId,
      postId,
      commentId: saved.id,
      previewText: hasContent ? dto.content!.slice(0, 100) : '📷 Image comment',
    });

    // Re-fetch with author relation so the response includes fullName/avatarUrl
    const commentWithAuthor = await queryRunner.manager.findOne(Comment, {
      where: { id: saved.id },
      relations: ['author'],
    });

    return commentWithAuthor ?? saved;
  }

  /**
   * Returns paginated comments for a post, newest first.
   *
   * The RLS SELECT policy on comments filters by tenant_id automatically.
   * We additionally filter by post_id so the response is scoped to the
   * requested post. The compound index idx_comments_post_created_desc
   * covers both filters efficiently.
   *
   * If the postId belongs to another tenant, RLS returns zero rows — the
   * same result as a post with no comments. This is intentional.
   */
  async getComments(postId: string, query: GetCommentsDto): Promise<PaginatedComments> {
    const { queryRunner } = this.getRlsContext();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    // Verify the post exists in the current tenant before returning comments.
    // Avoids returning an empty array for a post in another tenant (which could
    // mislead a client into thinking the post simply has no comments).
    const post = await queryRunner.manager.findOne(Post, { where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const [comments, total] = await queryRunner.manager.findAndCount(Comment, {
      where: { postId },
      relations: ['author'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { comments, total, limit, offset };
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
