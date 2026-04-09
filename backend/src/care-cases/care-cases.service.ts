import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateCareCaseDto } from './dto/create-care-case.dto';
import { UpdateCareCaseDto } from './dto/update-care-case.dto';
import { CreateCareNoteDto } from './dto/create-care-note.dto';

@Injectable()
export class CareCasesService {
  private readonly logger = new Logger(CareCasesService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getCases(
    tenantId: string,
    filters: { status?: string; priority?: string },
    limit: number,
    cursor?: string,
  ) {
    const conditions: string[] = ['c.tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.priority) {
      conditions.push(`c.priority = $${idx++}`);
      params.push(filters.priority);
    }
    if (cursor) {
      conditions.push(`c.created_at < $${idx++}`);
      params.push(cursor);
    }

    params.push(limit);

    const rows = await this.dataSource.query(
      `SELECT c.*, m.email AS member_email, a.email AS assignee_email
       FROM public.care_cases c
       LEFT JOIN public.users m ON m.id = c.member_id
       LEFT JOIN public.users a ON a.id = c.assigned_to
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC
       LIMIT $${idx}`,
      params,
    );

    return {
      data: rows.map((r: any) => this.mapCase(r)),
      cursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
  }

  async createCase(tenantId: string, dto: CreateCareCaseDto, userId: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.care_cases (tenant_id, member_id, title, description, priority, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        dto.memberId,
        dto.title,
        dto.description ?? null,
        dto.priority ?? 'medium',
        dto.assignedTo ?? null,
        userId,
      ],
    );

    return this.mapCase(row);
  }

  async getCase(tenantId: string, id: string) {
    const [row] = await this.dataSource.query(
      `SELECT c.*, m.email AS member_email, a.email AS assignee_email,
              (SELECT COUNT(*)::int FROM public.care_notes WHERE care_case_id = c.id) AS note_count
       FROM public.care_cases c
       LEFT JOIN public.users m ON m.id = c.member_id
       LEFT JOIN public.users a ON a.id = c.assigned_to
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenantId],
    );

    if (!row) throw new NotFoundException('Care case not found');
    return { ...this.mapCase(row), noteCount: row.note_count };
  }

  async updateCase(tenantId: string, id: string, dto: UpdateCareCaseDto) {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (dto.title !== undefined) { fields.push(`title = $${idx++}`); params.push(dto.title); }
    if (dto.description !== undefined) { fields.push(`description = $${idx++}`); params.push(dto.description); }
    if (dto.status !== undefined) {
      fields.push(`status = $${idx++}`);
      params.push(dto.status);
      if (dto.status === 'resolved') {
        fields.push(`resolved_at = now()`);
      }
    }
    if (dto.priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(dto.priority); }
    if (dto.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(dto.assignedTo); }

    if (fields.length === 0) {
      return this.getCase(tenantId, id);
    }

    fields.push(`updated_at = now()`);

    const [row] = await this.dataSource.query(
      `UPDATE public.care_cases SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      [...params, id, tenantId],
    );

    if (!row) throw new NotFoundException('Care case not found');
    return this.mapCase(row);
  }

  async getTimeline(tenantId: string, caseId: string) {
    // Verify the case belongs to the tenant
    const [caseRow] = await this.dataSource.query(
      `SELECT id FROM public.care_cases WHERE id = $1 AND tenant_id = $2`,
      [caseId, tenantId],
    );
    if (!caseRow) throw new NotFoundException('Care case not found');

    const rows = await this.dataSource.query(
      `SELECT n.*, u.email AS author_email
       FROM public.care_notes n
       LEFT JOIN public.users u ON u.id = n.author_id
       WHERE n.care_case_id = $1
       ORDER BY n.created_at ASC`,
      [caseId],
    );

    return {
      data: rows.map((r: any) => ({
        id: r.id,
        careCaseId: r.care_case_id,
        authorId: r.author_id,
        authorEmail: r.author_email,
        content: r.content,
        createdAt: r.created_at,
      })),
    };
  }

  async addNote(tenantId: string, caseId: string, dto: CreateCareNoteDto, userId: string) {
    // Verify the case belongs to the tenant
    const [caseRow] = await this.dataSource.query(
      `SELECT id FROM public.care_cases WHERE id = $1 AND tenant_id = $2`,
      [caseId, tenantId],
    );
    if (!caseRow) throw new NotFoundException('Care case not found');

    const [row] = await this.dataSource.query(
      `INSERT INTO public.care_notes (care_case_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [caseId, userId, dto.content],
    );

    return {
      id: row.id,
      careCaseId: row.care_case_id,
      authorId: row.author_id,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  async getCareKpis(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(CASE WHEN status = 'new' THEN 1 END)::int AS new_cases,
         COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
         COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int AS resolved,
         COUNT(CASE WHEN status = 'needs_leader' THEN 1 END)::int AS needs_leader,
         COUNT(CASE WHEN priority = 'urgent' AND status != 'resolved' THEN 1 END)::int AS urgent_count
       FROM public.care_cases WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      newCases: row.new_cases,
      inProgress: row.in_progress,
      resolved: row.resolved,
      needsLeader: row.needs_leader,
      urgentCount: row.urgent_count,
    };
  }

  private mapCase(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      memberId: r.member_id,
      memberEmail: r.member_email ?? null,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      assignedTo: r.assigned_to,
      assigneeEmail: r.assignee_email ?? null,
      createdBy: r.created_by,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
