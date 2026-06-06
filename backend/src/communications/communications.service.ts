import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { OneSignalService } from '../notifications/onesignal.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ScheduleMessageDto } from './dto/schedule-message.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly oneSignalService: OneSignalService,
    private readonly audit: AuditService,
  ) {}

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
    try {
      const [actor] = await this.dataSource.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
      await this.audit.log({
        action: 'notification.template_created',
        resourceType: 'notification',
        resourceId: row.id,
        summary: `${actor?.full_name ?? 'Admin'} created message template "${row.name}" (${row.channel})`,
        metadata: { name: row.name, channel: row.channel, hasSubject: !!row.subject },
      });
    } catch (err: any) {
      this.logger.warn(`notification.template_created audit failed (non-blocking): ${err.message}`);
    }
    return this.mapTemplate(row);
  }

  /* ───── Send / Schedule ───── */

  async sendMessage(tenantId: string, dto: SendMessageDto, userId: string) {
    // Fetch recipients: all members of this tenant with their contact info
    const recipients: Array<{ user_id: string; email: string; phone: string | null; full_name: string | null }> =
      await this.dataSource.query(
        `SELECT u.id AS user_id, u.email, u.phone, u.full_name
         FROM public.tenant_memberships tm
         JOIN public.users u ON u.id = tm.user_id
         WHERE tm.tenant_id = $1`,
        [tenantId],
      );

    // Get the church name for email branding
    const [tenant] = await this.dataSource.query(
      `SELECT name FROM public.tenants WHERE id = $1`, [tenantId],
    );
    const churchName = tenant?.name ?? undefined;

    const recipientCount = recipients.length;

    // Record the message in sent_messages
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

    // Dispatch through the appropriate channel (fire-and-forget)
    this.dispatchMessage(dto.channel, recipients, dto.subject ?? '', dto.body, churchName)
      .catch(err => this.logger.error(`Dispatch failed: ${err.message}`));

    return this.mapSentMessage(row);
  }

  /**
   * Actually sends the message through Email, SMS, or Push.
   */
  private async dispatchMessage(
    channel: string,
    recipients: Array<{ user_id: string; email: string; phone: string | null; full_name: string | null }>,
    subject: string,
    body: string,
    churchName?: string,
  ) {
    switch (channel) {
      case 'email': {
        const emails = recipients.map(r => r.email).filter(Boolean);
        if (emails.length > 0) {
          const result = await this.emailService.sendEmail(emails, subject, body, churchName);
          this.logger.log(`Email dispatch: ${result.sent} sent, ${result.failed} failed`);
        }
        break;
      }

      case 'sms': {
        const phones = recipients.map(r => r.phone).filter((p): p is string => !!p);
        if (phones.length > 0) {
          const result = await this.smsService.sendSms(phones, body);
          this.logger.log(`SMS dispatch: ${result.sent} sent, ${result.failed} failed`);
        } else {
          this.logger.warn('No phone numbers available for SMS dispatch');
        }
        break;
      }

      case 'push': {
        const userIds = recipients.map(r => r.user_id);
        let sent = 0;
        for (const uid of userIds) {
          await this.oneSignalService.sendPush(uid, subject || 'Church Update', body);
          sent++;
        }
        this.logger.log(`Push dispatch: ${sent} notifications queued`);
        break;
      }

      default:
        this.logger.warn(`Unknown channel: ${channel}`);
    }
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

    const totalSent = row?.total_sent ?? 0;

    // We don't yet capture open/click events server-side (no
    // sent_message_events table). Surface zeros so the mobile shape
    // matches { totalSent, totalOpened, totalClicked, openRate, clickRate }
    // and can render the analytics screen without optional-chaining
    // on every metric.
    const totalOpened = 0;
    const totalClicked = 0;

    return {
      totalSent,
      sentThisMonth: row?.sent_this_month ?? 0,
      avgRecipients: parseFloat(row?.avg_recipients) || 0,
      totalOpened,
      totalClicked,
      openRate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 1000) / 10 : 0,
      clickRate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 1000) / 10 : 0,
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
