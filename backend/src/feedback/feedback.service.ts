import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { TriageFeedbackDto } from './dto/triage-feedback.dto';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getFeedback(tenantId: string, type?: string) {
    const params: any[] = [tenantId];
    let sql = `
      SELECT f.*, u.full_name AS submitted_by_name
      FROM public.feedback f
      JOIN public.users u ON u.id = f.submitted_by
      WHERE f.tenant_id = $1`;

    if (type && ['node_request', 'bug_report', 'feature_request'].includes(type)) {
      params.push(type);
      sql += ` AND f.type = $${params.length}`;
    }

    sql += ` ORDER BY f.created_at DESC`;

    const rows = await this.dataSource.query(sql, params);

    return {
      data: rows.map((r: any) => this.mapRow(r)),
    };
  }

  async createFeedback(tenantId: string, userId: string, dto: CreateFeedbackDto) {
    // Migration 105: normalize the dual naming. Mobile sends
    // `screenshots` + `contextMeta`; legacy admin client (mig 104)
    // sent `screenshotUrls` + `deviceInfo`. Service accepts either,
    // canonicalizes to one set of column values.
    const screenshots = dto.screenshots ?? dto.screenshotUrls ?? [];
    const contextMeta = dto.contextMeta ?? dto.deviceInfo ?? {};

    const [row] = await this.dataSource.query(
      `INSERT INTO public.feedback
         (type, title, description, priority, submitted_by, tenant_id,
          screenshot_urls, device_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb)
       RETURNING *`,
      [
        dto.type,
        dto.title,
        dto.description,
        dto.priority ?? 'normal',
        userId,
        tenantId,
        screenshots,
        JSON.stringify(contextMeta),
      ],
    );

    this.logger.log(
      `Feedback submitted: ${row.id} (${row.type}/${row.priority}) by ${userId} in tenant ${tenantId}` +
        (screenshots.length ? ` + ${screenshots.length} screenshots` : ''),
    );
    return this.mapRow(row);
  }

  async updateStatus(tenantId: string, id: string, status: string) {
    const [row] = await this.dataSource.query(
      `UPDATE public.feedback SET status = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, status],
    );
    if (!row) throw new NotFoundException('Feedback not found');
    return { id: row.id, status: row.status, updatedAt: row.updated_at };
  }

  async deleteFeedback(tenantId: string, id: string) {
    const rows = await this.dataSource.query(
      `DELETE FROM public.feedback WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Feedback not found');
  }

  // ════════════════ Triage (migrations 104 + 105, super-admin only) ════════════════

  /**
   * Cross-tenant triage queue. Returns ALL feedback platform-wide,
   * sorted by priority (critical → low) then created_at ASC.
   *
   * Response shape (migration 105 — aligned with mobile team's
   * suggested shape from the Feedback v2 brief):
   *   {
   *     totalUntriaged,           // count of rows w/ triaged_at IS NULL
   *     count,                    // count in this response
   *     items: FeedbackItem[],    // flat list (back-compat)
   *     bucketed: {               // pre-categorized for cross-team handoff
   *       mobile:        FeedbackItem[],
   *       backend:       FeedbackItem[],
   *       admin_web:     FeedbackItem[],
   *       uncategorized: FeedbackItem[],
   *     }
   *   }
   *
   * Bucketing rules:
   *   - If row.category is set, use it directly.
   *   - Otherwise auto-derive via the heuristic (see categorize() below).
   *
   * SERVICE-ROLE BYPASS (per CLAUDE.md): cross-tenant aggregate read.
   * Guarded by SuperAdminGuard at the controller layer.
   */
  async listAllForTriage(filters: {
    status?: 'open' | 'in_progress' | 'completed' | 'closed' | 'all';
    category?: 'mobile' | 'backend' | 'admin_web' | 'uncategorized' | 'untriaged';
    priority?: 'low' | 'normal' | 'high' | 'critical';
    limit?: number;
  } = {}) {
    const params: any[] = [];
    const where: string[] = [];

    if (filters.status && filters.status !== 'all') {
      params.push(filters.status);
      where.push(`f.status = $${params.length}`);
    } else if (!filters.status) {
      where.push(`f.status IN ('open', 'in_progress')`);
    }

    if (filters.category === 'untriaged') {
      where.push(`f.category IS NULL`);
    } else if (filters.category) {
      params.push(filters.category);
      where.push(`f.category = $${params.length}`);
    }

    if (filters.priority) {
      params.push(filters.priority);
      where.push(`f.priority = $${params.length}`);
    }

    const limit = Math.min(filters.limit ?? 100, 500);

    const sql = `
      SELECT
        f.*,
        u.full_name AS submitted_by_name,
        u.email AS submitted_by_email,
        t.name AS tenant_name,
        tu.full_name AS triaged_by_name
      FROM public.feedback f
      JOIN public.users u ON u.id = f.submitted_by
      LEFT JOIN public.tenants t ON t.id = f.tenant_id
      LEFT JOIN public.users tu ON tu.id = f.triaged_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE f.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        f.created_at ASC
      LIMIT ${limit}
    `;

    const rows = await this.dataSource.query(sql, params);
    const totalUntriaged = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM public.feedback WHERE triaged_at IS NULL AND status != 'closed'`,
    );

    const items = rows.map((r: any) => ({
      ...this.mapRow(r),
      tenantName: r.tenant_name,
      submittedByEmail: r.submitted_by_email,
      triagedByName: r.triaged_by_name,
    }));

    // Bucket by category (auto-derive when NULL).
    const bucketed: Record<'mobile' | 'backend' | 'admin_web' | 'uncategorized', any[]> = {
      mobile: [],
      backend: [],
      admin_web: [],
      uncategorized: [],
    };
    for (const item of items) {
      const target = (item.category as keyof typeof bucketed | null) ?? this.categorize(item);
      bucketed[target].push(item);
    }

    return {
      totalUntriaged: totalUntriaged[0]?.n ?? 0,
      count: items.length,
      items,
      bucketed,
    };
  }

  /**
   * Auto-categorization heuristic for rows where category IS NULL
   * (untriaged). Per the mobile team's brief:
   *   - contextMeta.fromScreen starts with "Admin" → admin_web
   *   - description mentions network/server/sync/api/backend → backend
   *   - else → mobile (default — most users live in the mobile app)
   * Returns the bucket name. Doesn't write to the row — pure read-time
   * derivation. When I `POST /:id/triage` with the chosen category,
   * THAT writes to the row.
   */
  private categorize(item: any): 'mobile' | 'backend' | 'admin_web' | 'uncategorized' {
    const ctx = item.contextMeta ?? item.deviceInfo ?? {};
    const fromScreen: string = ctx.fromScreen ?? ctx.route ?? '';
    if (fromScreen.startsWith('Admin')) return 'admin_web';
    const desc = (item.description ?? '').toLowerCase();
    if (/network|server|sync|api|backend|database|500|timeout|503|502/i.test(desc)) {
      return 'backend';
    }
    return 'mobile';
  }

  /**
   * Triage a single feedback item. Stamps triaged_at + triaged_by.
   * At least one of category/priority/status/triageNotes must be
   * supplied (otherwise the call is a no-op — reject).
   */
  async triageFeedback(id: string, triagerUserId: string, dto: TriageFeedbackDto) {
    const updates: string[] = ['triaged_at = now()', 'triaged_by = $2', 'updated_at = now()'];
    const params: any[] = [id, triagerUserId];

    if (dto.category !== undefined) {
      params.push(dto.category);
      updates.push(`category = $${params.length}`);
    }
    if (dto.priority !== undefined) {
      params.push(dto.priority);
      updates.push(`priority = $${params.length}`);
    }
    if (dto.status !== undefined) {
      params.push(dto.status);
      updates.push(`status = $${params.length}`);
    }
    if (dto.triageNotes !== undefined) {
      params.push(dto.triageNotes);
      updates.push(`triage_notes = $${params.length}`);
    }

    if (params.length === 2) {
      throw new BadRequestException(
        'Triage body must include at least one of: category, priority, status, triageNotes',
      );
    }

    const [row] = await this.dataSource.query(
      `UPDATE public.feedback SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException('Feedback not found');
    this.logger.log(
      `Feedback ${id} triaged by ${triagerUserId}: category=${dto.category ?? '-'} priority=${dto.priority ?? '-'} status=${dto.status ?? '-'}`,
    );
    return this.mapRow(row);
  }

  /**
   * Row mapper. Emits BOTH naming conventions on read so old admin
   * clients reading `screenshotUrls`/`deviceInfo` keep working while
   * the mobile team's shipped client reads `screenshots`/`contextMeta`.
   */
  private mapRow(r: any) {
    const screenshots: string[] = r.screenshot_urls ?? [];
    const contextMeta: Record<string, any> = r.device_info ?? {};
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      submittedBy: r.submitted_by,
      submittedByName: r.submitted_by_name ?? null,
      tenantId: r.tenant_id,
      // Mobile v2 names (canonical):
      screenshots,
      contextMeta,
      // Legacy aliases (mig 104) — kept for any consumer still on the old names:
      screenshotUrls: screenshots,
      deviceInfo: contextMeta,
      category: r.category ?? null,
      triagedAt: r.triaged_at ?? null,
      triagedBy: r.triaged_by ?? null,
      triageNotes: r.triage_notes ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
