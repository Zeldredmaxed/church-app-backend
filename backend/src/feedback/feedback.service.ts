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
        dto.priority ?? 'medium',
        userId,
        tenantId,
        dto.screenshotUrls ?? [],
        JSON.stringify(dto.deviceInfo ?? {}),
      ],
    );

    this.logger.log(
      `Feedback submitted: ${row.id} (${row.type}/${row.priority}) by ${userId} in tenant ${tenantId}`,
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

  // ════════════════ Triage (migration 104, super-admin only) ════════════════

  /**
   * Cross-tenant triage queue. Returns ALL feedback platform-wide,
   * sorted by priority (critical → high → medium → low) then
   * created_at ASC (oldest unhandled first).
   *
   * SERVICE-ROLE BYPASS (documented per CLAUDE.md): this is the only
   * place that intentionally crosses tenant boundaries — the
   * super-admin (currently Zel; future Paperclip Triage Officer
   * agent) needs to see every report regardless of which church it
   * came from. Tenant_id is included in the response so the triager
   * knows the source.
   *
   * Filters:
   *   - status (default: open + in_progress; pass 'all' to include closed/completed)
   *   - category (frontend|backend|admin|unknown; pass 'untriaged' for category IS NULL)
   *   - priority (low|medium|high|critical)
   *   - limit (default 100, max 500)
   */
  async listAllForTriage(filters: {
    status?: 'open' | 'in_progress' | 'completed' | 'closed' | 'all';
    category?: 'frontend' | 'backend' | 'admin' | 'unknown' | 'untriaged';
    priority?: 'low' | 'medium' | 'high' | 'critical';
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
          WHEN 'medium' THEN 2
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

    return {
      totalUntriaged: totalUntriaged[0]?.n ?? 0,
      count: rows.length,
      items: rows.map((r: any) => ({
        ...this.mapRow(r),
        tenantName: r.tenant_name,
        submittedByEmail: r.submitted_by_email,
        triagedByName: r.triaged_by_name,
      })),
    };
  }

  /**
   * Triage a single feedback item. Stamps triaged_at + triaged_by.
   * At least one of category/priority/status/triageNotes must be
   * supplied (otherwise the call is a no-op — reject).
   *
   * SERVICE-ROLE: no tenant_id filter on the UPDATE — by design,
   * triage crosses tenant boundaries. Guarded by SuperAdminGuard at
   * the controller layer.
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

    // Reject body-with-no-field calls (would silently no-op).
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

  // ─── shared row mapper ───
  private mapRow(r: any) {
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
      screenshotUrls: r.screenshot_urls ?? [],
      deviceInfo: r.device_info ?? {},
      category: r.category ?? null,
      triagedAt: r.triaged_at ?? null,
      triagedBy: r.triaged_by ?? null,
      triageNotes: r.triage_notes ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
