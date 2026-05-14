import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ModerationService {
  constructor(private readonly audit: AuditService) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getReports(status: 'pending' | 'reviewed' | 'removed', limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1, status];
    let sql = `
      SELECT r.*,
        p.media_url AS post_thumbnail,
        u.full_name AS author_name
      FROM public.post_reports r
      LEFT JOIN public.posts p ON p.id = r.post_id
      LEFT JOIN public.users u ON u.id = p.author_id
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

    // Always include counts
    const countRows = await queryRunner.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
        COUNT(*) FILTER (WHERE status = 'removed')::int AS removed
      FROM public.post_reports`,
    );

    return {
      items: items.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        postId: r.post_id,
        reportedBy: r.reported_by,
        reason: r.reason,
        status: r.status,
        reviewedBy: r.reviewed_by,
        postThumbnail: r.post_thumbnail,
        authorName: r.author_name,
        createdAt: r.created_at,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      counts: countRows[0],
    };
  }

  async approveReport(id: string, reviewerId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `UPDATE public.post_reports SET status = 'reviewed', reviewed_by = $2 WHERE id = $1 RETURNING id, post_id`,
      [id, reviewerId],
    );
    if (rows.length === 0) throw new NotFoundException('Report not found');

    const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [reviewerId]);
    await this.audit.log({
      action: 'report.dismissed',
      resourceType: 'post',
      resourceId: rows[0].post_id,
      summary: `${actor?.full_name ?? 'Admin'} dismissed report ${id} (post left in place)`,
      metadata: { reportId: id, decision: 'dismiss', postId: rows[0].post_id },
    });

    return { message: 'Report approved' };
  }

  async removeReport(id: string, reviewerId: string) {
    const { queryRunner } = this.getRlsContext();

    // Get the post_id (plus author for audit) before we start mutating.
    const rows = await queryRunner.query(
      `SELECT pr.post_id, p.author_id, p.content
       FROM public.post_reports pr
       LEFT JOIN public.posts p ON p.id = pr.post_id
       WHERE pr.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Report not found');

    const { post_id: postId, author_id: authorId, content: postContent } = rows[0];

    // Update report status
    await queryRunner.query(
      `UPDATE public.post_reports SET status = 'removed', reviewed_by = $2 WHERE id = $1`,
      [id, reviewerId],
    );

    // Delete the post
    await queryRunner.query(
      `DELETE FROM public.posts WHERE id = $1`,
      [postId],
    );

    const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [reviewerId]);
    await this.audit.log({
      action: 'report.actioned',
      resourceType: 'post',
      resourceId: postId,
      targetUserId: authorId ?? null,
      summary: `${actor?.full_name ?? 'Admin'} actioned report ${id} — removed reported post`,
      metadata: {
        reportId: id,
        decision: 'remove_post',
        postId,
        authorId,
        contentPreview: (postContent ?? '').slice(0, 200),
      },
    });
    // Also emit the post.deleted entry so the post-history search picks it up.
    await this.audit.log({
      action: 'post.deleted',
      resourceType: 'post',
      resourceId: postId,
      targetUserId: authorId ?? null,
      summary: `${actor?.full_name ?? 'Admin'} deleted reported post`,
      metadata: { authorId, via: 'report_action', reportId: id, contentPreview: (postContent ?? '').slice(0, 200) },
    });

    return { message: 'Report resolved and post removed' };
  }
}
