import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getTasks(
    tenantId: string,
    filters: { status?: string; priority?: string; assignedTo?: string; linkedType?: string; linkedId?: string },
    limit: number,
    cursor?: string,
  ) {
    const conditions: string[] = ['t.tenant_id = $1'];
    const params: any[] = [tenantId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.priority) {
      conditions.push(`t.priority = $${idx++}`);
      params.push(filters.priority);
    }
    if (filters.assignedTo) {
      conditions.push(`t.assigned_to = $${idx++}`);
      params.push(filters.assignedTo);
    }
    if (filters.linkedType) {
      conditions.push(`t.linked_type = $${idx++}`);
      params.push(filters.linkedType);
    }
    if (filters.linkedId) {
      conditions.push(`t.linked_id = $${idx++}`);
      params.push(filters.linkedId);
    }
    if (cursor) {
      conditions.push(`t.created_at < $${idx++}`);
      params.push(cursor);
    }

    params.push(limit);

    const rows = await this.dataSource.query(
      `SELECT t.*, u.email AS assignee_email
       FROM public.tasks t
       LEFT JOIN public.users u ON u.id = t.assigned_to
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT $${idx}`,
      params,
    );

    return {
      data: rows.map((r: any) => this.mapTask(r)),
      cursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
  }

  async createTask(tenantId: string, dto: CreateTaskDto, userId: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.tasks (tenant_id, title, description, status, priority, assigned_to, created_by, due_date, linked_type, linked_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        dto.title,
        dto.description ?? null,
        dto.status ?? 'pending',
        dto.priority ?? 'medium',
        dto.assignedTo ?? null,
        userId,
        dto.dueDate ?? null,
        dto.linkedType ?? null,
        dto.linkedId ?? null,
      ],
    );

    return this.mapTask(row);
  }

  async getTask(tenantId: string, id: string) {
    const [row] = await this.dataSource.query(
      `SELECT t.*, u.email AS assignee_email
       FROM public.tasks t
       LEFT JOIN public.users u ON u.id = t.assigned_to
       WHERE t.id = $1 AND t.tenant_id = $2`,
      [id, tenantId],
    );

    if (!row) throw new NotFoundException('Task not found');
    return this.mapTask(row);
  }

  async updateTask(tenantId: string, id: string, dto: UpdateTaskDto) {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (dto.title !== undefined) { fields.push(`title = $${idx++}`); params.push(dto.title); }
    if (dto.description !== undefined) { fields.push(`description = $${idx++}`); params.push(dto.description); }
    if (dto.status !== undefined) { fields.push(`status = $${idx++}`); params.push(dto.status); }
    if (dto.priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(dto.priority); }
    if (dto.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(dto.assignedTo); }
    if (dto.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); params.push(dto.dueDate); }
    if (dto.linkedType !== undefined) { fields.push(`linked_type = $${idx++}`); params.push(dto.linkedType); }
    if (dto.linkedId !== undefined) { fields.push(`linked_id = $${idx++}`); params.push(dto.linkedId); }

    if (fields.length === 0) {
      return this.getTask(tenantId, id);
    }

    fields.push(`updated_at = now()`);

    const [row] = await this.dataSource.query(
      `UPDATE public.tasks SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      [...params, id, tenantId],
    );

    if (!row) throw new NotFoundException('Task not found');
    return this.mapTask(row);
  }

  async deleteTask(tenantId: string, id: string) {
    const result = await this.dataSource.query(
      `DELETE FROM public.tasks WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );

    if (result.length === 0) throw new NotFoundException('Task not found');
    return { deleted: true };
  }

  async completeTask(tenantId: string, id: string) {
    const [row] = await this.dataSource.query(
      `UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId],
    );

    if (!row) throw new NotFoundException('Task not found');
    return this.mapTask(row);
  }

  async getTaskKpis(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending,
         COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
         COUNT(CASE WHEN priority IN ('high', 'urgent') AND status != 'completed' THEN 1 END)::int AS high_priority,
         COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'completed' THEN 1 END)::int AS overdue
       FROM public.tasks WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      pending: row.pending,
      inProgress: row.in_progress,
      highPriority: row.high_priority,
      overdue: row.overdue,
    };
  }

  async getLinkedTasks(tenantId: string, linkedType: string, linkedId: string) {
    const rows = await this.dataSource.query(
      `SELECT t.*, u.email AS assignee_email
       FROM public.tasks t
       LEFT JOIN public.users u ON u.id = t.assigned_to
       WHERE t.tenant_id = $1 AND t.linked_type = $2 AND t.linked_id = $3
       ORDER BY t.created_at DESC`,
      [tenantId, linkedType, linkedId],
    );

    return { data: rows.map((r: any) => this.mapTask(r)) };
  }

  private mapTask(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      assignedTo: r.assigned_to,
      assigneeEmail: r.assignee_email ?? null,
      createdBy: r.created_by,
      dueDate: r.due_date,
      completedAt: r.completed_at,
      linkedType: r.linked_type,
      linkedId: r.linked_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
