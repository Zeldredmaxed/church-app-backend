import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';

type ContentType = 'post' | 'comment' | 'user' | 'message';

@Injectable()
export class ModerationService {
  constructor(private readonly audit: AuditService) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  /**
   * Moderation v2: branches on content_type so comment/user/message
   * reports get their own preview, link, and "remove" action — not
   * silently treated as posts. The previous implementation hardcoded
   * LEFT JOIN posts and DELETE FROM posts, which meant reports against
   * comments / users / DMs showed NULL thumbnails AND the remove action
   * was a no-op while flipping status to 'removed' (hiding the abuse
   * from review).
   */
  async getReports(status: 'pending' | 'reviewed' | 'removed', limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1, status];
    let sql = `
      SELECT r.*,
        -- post details
        p.media_url   AS post_thumbnail,
        p.content     AS post_content,
        pu.full_name  AS post_author_name,
        pu.id         AS post_author_id,
        -- comment details
        c.content     AS comment_content,
        cu.full_name  AS comment_author_name,
        cu.id         AS comment_author_id,
        c.post_id     AS comment_post_id,
        -- reported user details
        ru.full_name  AS reported_user_name,
        ru.avatar_url AS reported_user_avatar,
        -- chat message details (if message_id stored in comment_id column or similar)
        mu.full_name  AS message_author_name,
        cm.channel_id AS message_channel_id
      FROM public.post_reports r
      LEFT JOIN public.posts p ON p.id = r.post_id
      LEFT JOIN public.users pu ON pu.id = p.author_id
      LEFT JOIN public.comments c ON c.id = r.comment_id
      LEFT JOIN public.users cu ON cu.id = c.author_id
      LEFT JOIN public.users ru ON ru.id = r.user_id
      LEFT JOIN public.chat_messages cm ON cm.id = r.comment_id AND r.content_type = 'message'
      LEFT JOIN public.users mu ON mu.id = cm.user_id
      WHERE r.status = $2
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND r.id < $${params.length}`;
    }

    sql += ` ORDER BY r.created_at DESC LIMIT $1`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const countRows = await queryRunner.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
        COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
        COUNT(*) FILTER (WHERE status = 'removed')::int  AS removed
      FROM public.post_reports`,
    );

    return {
      items: items.map((r: any) => this.mapReport(r)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      counts: countRows[0],
    };
  }

  private mapReport(r: any) {
    const contentType = (r.content_type ?? 'post') as ContentType;
    const base = {
      id: r.id,
      tenantId: r.tenant_id,
      contentType,
      reportedBy: r.reported_by,
      reason: r.reason,
      status: r.status,
      reviewedBy: r.reviewed_by,
      createdAt: r.created_at,
    };
    switch (contentType) {
      case 'post':
        return {
          ...base,
          targetId: r.post_id,
          preview: {
            kind: 'post' as const,
            thumbnail: r.post_thumbnail,
            content: (r.post_content ?? '').slice(0, 200),
            authorName: r.post_author_name,
            authorId: r.post_author_id,
          },
        };
      case 'comment':
        return {
          ...base,
          targetId: r.comment_id,
          preview: {
            kind: 'comment' as const,
            content: (r.comment_content ?? '').slice(0, 200),
            authorName: r.comment_author_name,
            authorId: r.comment_author_id,
            postId: r.comment_post_id,
          },
        };
      case 'user':
        return {
          ...base,
          targetId: r.user_id,
          preview: {
            kind: 'user' as const,
            fullName: r.reported_user_name,
            avatarUrl: r.reported_user_avatar,
            userId: r.user_id,
          },
        };
      case 'message':
        return {
          ...base,
          targetId: r.comment_id, // message_id is stored in comment_id column for messages
          preview: {
            kind: 'message' as const,
            authorName: r.message_author_name,
            messageId: r.comment_id,
            channelId: r.message_channel_id,
          },
        };
      default:
        return base;
    }
  }

  async approveReport(id: string, reviewerId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `UPDATE public.post_reports SET status = 'reviewed', reviewed_by = $2
       WHERE id = $1
       RETURNING id, post_id, comment_id, user_id, content_type`,
      [id, reviewerId],
    );
    if (rows.length === 0) throw new NotFoundException('Report not found');
    const r = rows[0];

    const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [reviewerId]);
    await this.audit.log({
      action: 'report.dismissed',
      resourceType: r.content_type ?? 'post',
      resourceId: r.post_id ?? r.comment_id ?? r.user_id,
      summary: `${actor?.full_name ?? 'Admin'} dismissed ${r.content_type ?? 'post'} report ${id}`,
      metadata: { reportId: id, decision: 'dismiss', contentType: r.content_type ?? 'post' },
    });

    return { message: 'Report dismissed' };
  }

  /**
   * Take action on a report — branches by content_type. Posts are
   * hard-deleted (existing behavior). Comments are hard-deleted via the
   * comments table. Chat messages are soft-deleted (deleted_at + deleted_by
   * + deleted_reason) so context is preserved for any follow-up review.
   * User reports flag the user — we don't auto-suspend; admins still need
   * to act via /api/admin/users/:id/suspend (not built yet — flagged below).
   */
  async removeReport(id: string, reviewerId: string) {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT pr.id, pr.post_id, pr.comment_id, pr.user_id, pr.content_type, pr.reason,
              p.author_id AS post_author_id, p.content AS post_content,
              c.author_id AS comment_author_id, c.content AS comment_content,
              cm.user_id AS message_author_id, cm.content AS message_content
       FROM public.post_reports pr
       LEFT JOIN public.posts p ON p.id = pr.post_id
       LEFT JOIN public.comments c ON c.id = pr.comment_id
       LEFT JOIN public.chat_messages cm ON cm.id = pr.comment_id AND pr.content_type = 'message'
       WHERE pr.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Report not found');
    const report = rows[0];
    const contentType: ContentType = report.content_type ?? 'post';
    const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [reviewerId]);
    const actorName = actor?.full_name ?? 'Admin';

    // Mark the report resolved up front so a partial-failure on the
    // content delete doesn't strand it as pending.
    await queryRunner.query(
      `UPDATE public.post_reports SET status = 'removed', reviewed_by = $2 WHERE id = $1`,
      [id, reviewerId],
    );

    if (contentType === 'post') {
      if (!report.post_id) throw new BadRequestException('Report has no post_id');
      await queryRunner.query(`DELETE FROM public.posts WHERE id = $1`, [report.post_id]);
      await this.audit.log({
        action: 'post.deleted',
        resourceType: 'post',
        resourceId: report.post_id,
        targetUserId: report.post_author_id ?? null,
        summary: `${actorName} deleted reported post`,
        metadata: {
          via: 'report_action',
          reportId: id,
          reason: report.reason,
          contentPreview: (report.post_content ?? '').slice(0, 200),
        },
      });
    } else if (contentType === 'comment') {
      if (!report.comment_id) throw new BadRequestException('Report has no comment_id');
      await queryRunner.query(`DELETE FROM public.comments WHERE id = $1`, [report.comment_id]);
      await this.audit.log({
        action: 'comment.deleted',
        resourceType: 'comment',
        resourceId: report.comment_id,
        targetUserId: report.comment_author_id ?? null,
        summary: `${actorName} deleted reported comment`,
        metadata: {
          via: 'report_action',
          reportId: id,
          reason: report.reason,
          contentPreview: (report.comment_content ?? '').slice(0, 200),
        },
      });
    } else if (contentType === 'message') {
      if (!report.comment_id) throw new BadRequestException('Report has no message_id');
      await queryRunner.query(
        `UPDATE public.chat_messages
         SET deleted_at = now(), deleted_by = $2, deleted_reason = $3
         WHERE id = $1 AND deleted_at IS NULL`,
        [report.comment_id, reviewerId, `Report ${id}: ${report.reason}`],
      );
      await this.audit.log({
        action: 'chat.message_removed',
        resourceType: 'message',
        resourceId: report.comment_id,
        targetUserId: report.message_author_id ?? null,
        summary: `${actorName} removed reported chat message`,
        metadata: {
          via: 'report_action',
          reportId: id,
          reason: report.reason,
          contentPreview: (report.message_content ?? '').slice(0, 200),
        },
      });
    } else if (contentType === 'user') {
      // We don't auto-suspend users. Audit the action so the admin team
      // can follow up with a manual decision via the user-management
      // flow. The report is still flipped to 'removed' so it doesn't
      // re-enter the queue.
      await this.audit.log({
        action: 'report.user_flagged',
        resourceType: 'user',
        resourceId: report.user_id,
        targetUserId: report.user_id,
        summary: `${actorName} acknowledged a user report — follow up manually`,
        metadata: { via: 'report_action', reportId: id, reason: report.reason },
      });
    }

    return {
      message: 'Report resolved',
      contentType,
      action: contentType === 'message' ? 'soft_deleted' : contentType === 'user' ? 'flagged' : 'hard_deleted',
    };
  }
}
