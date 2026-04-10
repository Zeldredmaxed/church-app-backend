import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
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
      data: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        description: r.description,
        priority: r.priority,
        status: r.status,
        submittedBy: r.submitted_by,
        submittedByName: r.submitted_by_name,
        tenantId: r.tenant_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async createFeedback(tenantId: string, userId: string, dto: CreateFeedbackDto) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.feedback (type, title, description, priority, submitted_by, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [dto.type, dto.title, dto.description, dto.priority ?? 'medium', userId, tenantId],
    );

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      submittedBy: row.submitted_by,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
    };
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
}
