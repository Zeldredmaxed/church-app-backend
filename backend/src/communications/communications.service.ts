import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ScheduleMessageDto } from './dto/schedule-message.dto';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /* ───── Audience Segments ───── */

  async getSegments(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM public.audience_segments WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return { data: rows.map((r: any) => this.mapSegment(r)) };
  }

  async createSegment(tenantId: string, dto: CreateSegmentDto, userId: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.audience_segments (tenant_id, name, rules, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, dto.name, JSON.stringify(dto.rules), userId],
    );
    return this.mapSegment(row);
  }

  async previewSegment(tenantId: string, rules: Record<string, any>) {
    // Future: apply rules to filter members. For now, return total member count.
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS matched_count FROM public.tenant_memberships WHERE tenant_id = $1`,
      [tenantId],
    );
    return { matchedCount: row.matched_count };
  }

  /* ───── Message Templates ───── */

  async getTemplates(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM public.message_templates WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return { data: rows.map((r: any) => this.mapTemplate(r)) };
  }

  async createTemplate(tenantId: string, dto: CreateTemplateDto, userId: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.message_templates (tenant_id, name, subject, body, channel, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, dto.name, dto.subject ?? null, dto.body, dto.channel, userId],
    );
    return this.mapTemplate(row);
  }

  /* ───── Send / Schedule ───── */

  async sendMessage(tenantId: string, dto: SendMessageDto, userId: string) {
    // Count recipients: from segment or all members
    let recipientCount = 0;
    if (dto.segmentId) {
      const [seg] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS cnt FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      );
      recipientCount = seg.cnt;
    } else {
      const [all] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS cnt FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      );
      recipientCount = all.cnt;
    }

    const [row] = await this.dataSource.query(
      `INSERT INTO public.sent_messages
         (tenant_id, segment_id, template_id, channel, subject, body, recipient_count, sent_by, sent_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), 'sent')
       RETURNING *`,
      [
        tenantId,
        dto.segmentId ?? null,
        dto.templateId ?? null,
        dto.channel,
        dto.subject ?? null,
        dto.body,
        recipientCount,
        userId,
      ],
    );

    // TODO: Actual email/SMS/push sending integration
    this.logger.log(`Message sent to ${recipientCount} recipients (channel=${dto.channel})`);

    return this.mapSentMessage(row);
  }

  async scheduleMessage(tenantId: string, dto: ScheduleMessageDto, userId: string) {
    let recipientCount = 0;
    const [cnt] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM public.tenant_memberships WHERE tenant_id = $1`,
      [tenantId],
    );
    recipientCount = cnt.cnt;

    const [row] = await this.dataSource.query(
      `INSERT INTO public.sent_messages
         (tenant_id, segment_id, template_id, channel, subject, body, recipient_count, sent_by, scheduled_for, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled')
       RETURNING *`,
      [
        tenantId,
        dto.segmentId ?? null,
        dto.templateId ?? null,
        dto.channel,
        dto.subject ?? null,
        dto.body,
        recipientCount,
        userId,
        dto.scheduledFor,
      ],
    );

    // TODO: Actual scheduler integration
    this.logger.log(`Message scheduled for ${dto.scheduledFor}`);

    return this.mapSentMessage(row);
  }

  /* ───── History & Analytics ───── */

  async getHistory(tenantId: string, limit: number, cursor?: string) {
    const params: any[] = [tenantId];
    let idx = 2;
    let cursorClause = '';

    if (cursor) {
      cursorClause = `AND sm.created_at < $${idx++}`;
      params.push(cursor);
    }

    params.push(limit);

    const rows = await this.dataSource.query(
      `SELECT sm.* FROM public.sent_messages sm
       WHERE sm.tenant_id = $1 ${cursorClause}
       ORDER BY sm.created_at DESC
       LIMIT $${idx}`,
      params,
    );

    return {
      data: rows.map((r: any) => this.mapSentMessage(r)),
      cursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    };
  }

  async getAnalytics(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(*)::int AS total_sent,
         COUNT(CASE WHEN sent_at >= date_trunc('month', now()) THEN 1 END)::int AS sent_this_month,
         COALESCE(AVG(recipient_count), 0)::float AS avg_recipients
       FROM public.sent_messages
       WHERE tenant_id = $1 AND status = 'sent'`,
      [tenantId],
    );

    return {
      totalSent: row.total_sent,
      sentThisMonth: row.sent_this_month,
      avgRecipients: parseFloat(row.avg_recipients) || 0,
    };
  }

  /* ───── Mappers ───── */

  private mapSegment(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      rules: r.rules,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }

  private mapTemplate(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      subject: r.subject,
      body: r.body,
      channel: r.channel,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }

  private mapSentMessage(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      segmentId: r.segment_id,
      templateId: r.template_id,
      channel: r.channel,
      subject: r.subject,
      body: r.body,
      recipientCount: r.recipient_count,
      sentBy: r.sent_by,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at,
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
