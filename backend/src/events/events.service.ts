import { Injectable, NotFoundException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { Event } from './entities/event.entity';
import { EventRsvp } from './entities/event-rsvp.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EventsService {
  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private async actorName(userId: string): Promise<string> {
    const [r] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`, [userId],
    );
    return r?.full_name ?? 'Admin';
  }

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getEvents(upcoming: boolean, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1];
    let sql = `
      SELECT e.*,
        (SELECT COUNT(*)::int FROM public.event_rsvps WHERE event_id = e.id AND status = 'going') AS attendee_count
      FROM public.events e
    `;

    if (upcoming) {
      sql += ` WHERE e.start_at >= now()`;
    }

    if (cursor) {
      params.push(cursor);
      sql += upcoming ? ' AND' : ' WHERE';
      sql += ` e.id < $${params.length}`;
    }

    sql += ` ORDER BY e.start_at ${upcoming ? 'ASC' : 'DESC'} LIMIT $1`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;

    return {
      events: events.map((r: any) => this.mapEvent(r)),
      nextCursor: hasMore ? events[events.length - 1].id : null,
    };
  }

  async getEvent(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT e.*,
        (SELECT COUNT(*)::int FROM public.event_rsvps WHERE event_id = e.id AND status = 'going') AS attendee_count,
        (SELECT status FROM public.event_rsvps WHERE event_id = e.id AND user_id = $2) AS my_rsvp
      FROM public.events e WHERE e.id = $1`,
      [id, userId],
    );
    if (!rows.length) throw new NotFoundException('Event not found');
    const r = rows[0];
    return {
      ...this.mapEvent(r),
      isGoing: r.my_rsvp === 'going',
      isInterested: r.my_rsvp === 'interested',
    };
  }

  async createEvent(dto: CreateEventDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const event = queryRunner.manager.create(Event, {
      tenantId: currentTenantId!,
      title: dto.title,
      description: dto.description ?? '',
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      location: dto.location ?? '',
      coverImageUrl: dto.coverImageUrl ?? null,
      isFeatured: dto.isFeatured ?? false,
      createdBy: userId,
    });
    const saved = await queryRunner.manager.save(Event, event);
    await this.audit.log({
      action: 'event.created',
      resourceType: 'event',
      resourceId: saved.id,
      summary: `${await this.actorName(userId)} created event "${saved.title}"`,
      metadata: { title: saved.title, startAt: saved.startAt, location: saved.location },
    });
    return saved;
  }

  async updateEvent(id: string, dto: Partial<CreateEventDto>) {
    const { queryRunner, userId } = this.getRlsContext();
    const updates: any = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.startAt !== undefined) updates.startAt = new Date(dto.startAt);
    if (dto.endAt !== undefined) updates.endAt = new Date(dto.endAt);
    if (dto.location !== undefined) updates.location = dto.location;
    if (dto.coverImageUrl !== undefined) updates.coverImageUrl = dto.coverImageUrl;
    if (dto.isFeatured !== undefined) updates.isFeatured = dto.isFeatured;

    const result = await queryRunner.manager.update(Event, { id }, updates);
    if (result.affected === 0) throw new NotFoundException('Event not found');
    const after = await queryRunner.manager.findOneOrFail(Event, { where: { id } });
    await this.audit.log({
      action: 'event.updated',
      resourceType: 'event',
      resourceId: id,
      summary: `${await this.actorName(userId)} updated event "${after.title}"`,
      metadata: { changedFields: Object.keys(dto), title: after.title },
    });
    return after;
  }

  /**
   * Cancel an event without removing it.
   *
   * Cancellation differs from delete in three ways:
   *   1. The event row stays in place — attendees see it marked cancelled
   *      instead of vanishing from the calendar.
   *   2. All "going" and "interested" RSVPs are notified via BullMQ so they
   *      don't show up to a non-event.
   *   3. The audit log captures the optional reason for posterity.
   *
   * Idempotent — cancelling a cancelled event returns 409 rather than
   * re-firing notifications.
   */
  async cancelEvent(id: string, reason: string | null) {
    const { queryRunner, userId, currentTenantId } = this.getRlsContext();
    const event = await queryRunner.manager.findOne(Event, { where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.cancelledAt) {
      throw new ConflictException('Event is already cancelled');
    }

    const now = new Date();
    await queryRunner.manager.update(
      Event,
      { id },
      { cancelledAt: now, cancellationReason: reason },
    );

    // Notify everyone who RSVPed (going OR interested) via the bulk path.
    // Use the RLS queryRunner so the RSVP read stays tenant-scoped.
    const rsvps: Array<{ user_id: string }> = await queryRunner.query(
      `SELECT user_id FROM public.event_rsvps
       WHERE event_id = $1 AND status IN ('going', 'interested')`,
      [id],
    );
    if (rsvps.length > 0) {
      await this.notificationsQueue.add('event_cancelled', {
        type: 'event_cancelled',
        tenantId: currentTenantId,
        actorUserId: userId,
        recipientIds: rsvps.map(r => r.user_id),
        eventId: id,
        eventTitle: event.title,
        eventDate: event.startAt,
        reason: reason ?? undefined,
      });
    }

    await this.audit.log({
      action: 'event.cancelled',
      resourceType: 'event',
      resourceId: id,
      summary: `${await this.actorName(userId)} cancelled event "${event.title}"`,
      metadata: {
        title: event.title,
        startAt: event.startAt,
        reason,
        notifiedCount: rsvps.length,
      },
    });

    return {
      id,
      cancelledAt: now,
      cancellationReason: reason,
      notifiedCount: rsvps.length,
    };
  }

  async deleteEvent(id: string) {
    const { queryRunner, userId } = this.getRlsContext();
    const before = await queryRunner.manager.findOne(Event, { where: { id } });
    const result = await queryRunner.manager.delete(Event, { id });
    if (result.affected === 0) throw new NotFoundException('Event not found');
    await this.audit.log({
      action: 'event.deleted',
      resourceType: 'event',
      resourceId: id,
      summary: `${await this.actorName(userId)} deleted event "${before?.title ?? '(unknown)'}"`,
      metadata: { title: before?.title, startAt: before?.startAt },
    });
  }

  async rsvp(eventId: string, userId: string, status: string) {
    const { queryRunner } = this.getRlsContext();
    if (status === 'not_going') {
      await queryRunner.query(
        `DELETE FROM public.event_rsvps WHERE event_id = $1 AND user_id = $2`,
        [eventId, userId],
      );
    } else {
      await queryRunner.query(
        `INSERT INTO public.event_rsvps (event_id, user_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3`,
        [eventId, userId, status],
      );
    }
    return { status };
  }

  async getAttendees(eventId: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [eventId, limit + 1];
    let sql = `
      SELECT u.id, u.full_name AS "fullName", u.avatar_url AS "avatarUrl", u.email
      FROM public.event_rsvps r
      JOIN public.users u ON u.id = r.user_id
      WHERE r.event_id = $1 AND r.status = 'going'
    `;
    if (cursor) {
      params.push(cursor);
      sql += ` AND u.id > $${params.length}`;
    }
    sql += ` ORDER BY u.full_name ASC LIMIT $2`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const attendees = hasMore ? rows.slice(0, limit) : rows;

    return {
      attendees,
      nextCursor: hasMore ? attendees[attendees.length - 1].id : null,
    };
  }

  private mapEvent(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      description: r.description,
      startAt: r.start_at,
      endAt: r.end_at,
      location: r.location,
      coverImageUrl: r.cover_image_url,
      isFeatured: r.is_featured,
      attendeeCount: Number(r.attendee_count ?? 0),
      cancelledAt: r.cancelled_at ?? null,
      cancellationReason: r.cancellation_reason ?? null,
      createdAt: r.created_at,
    };
  }

  /**
   * Generate an iCal feed for all upcoming events in a tenant.
   * Public — no auth required (used for calendar subscription URLs).
   */
  /**
   * Generate or rotate the tenant's iCal subscription token. Returns
   * the new URL clients can hand to Google Calendar / Apple Calendar
   * / Outlook. Rotation invalidates the previous URL — useful if it
   * leaks.
   */
  async regenerateIcalToken(tenantId: string): Promise<{ token: string; url: string }> {
    const token = require('crypto').randomBytes(32).toString('base64url');
    await this.dataSource.query(
      `UPDATE public.tenants SET ical_token = $1 WHERE id = $2`,
      [token, tenantId],
    );
    const baseUrl = process.env.RENDER_EXTERNAL_URL ?? 'https://church-app-backend-27hc.onrender.com';
    return {
      token,
      url: `${baseUrl}/api/events/ical-public/${tenantId}?token=${token}`,
    };
  }

  /**
   * Token-authenticated public iCal feed. Bearer auth bypassed (handled
   * by the separate PublicICalController). Verifies token via
   * constant-time compare to thwart token enumeration via timing.
   */
  async getPublicICalFeed(tenantId: string, providedToken: string | undefined): Promise<string> {
    if (!providedToken || providedToken.length > 200) {
      throw new (require('@nestjs/common').UnauthorizedException)('Invalid token');
    }
    const [row] = await this.dataSource.query(
      `SELECT ical_token FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    const stored: string | null = row?.ical_token ?? null;
    if (!stored) {
      throw new (require('@nestjs/common').UnauthorizedException)('iCal feed not enabled for this tenant');
    }
    const a = Buffer.from(stored);
    const b = Buffer.from(providedToken);
    if (a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
      throw new (require('@nestjs/common').UnauthorizedException)('Invalid token');
    }
    return this.getICalFeed(tenantId);
  }

  async getICalFeed(tenantId: string): Promise<string> {
    const [tenant] = await this.dataSource.query(
      `SELECT name FROM public.tenants WHERE id = $1`, [tenantId],
    );
    const churchName = tenant?.name ?? 'Church';

    const events = await this.dataSource.query(
      `SELECT title, description, start_at, end_at, location, cancelled_at
       FROM public.events
       WHERE tenant_id = $1 AND start_at >= now() - interval '30 days'
       ORDER BY start_at ASC LIMIT 100`,
      [tenantId],
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//Shepherd//${churchName}//EN`,
      `X-WR-CALNAME:${churchName} Events`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const e of events) {
      const uid = Buffer.from(e.title + e.start_at).toString('base64').substring(0, 20);
      const dtStart = new Date(e.start_at).toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
      const dtEnd = new Date(e.end_at).toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
      const block: string[] = [
        'BEGIN:VEVENT',
        `UID:${uid}@shepard.app`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${(e.title || '').replace(/[,;\\]/g, '')}`,
        `DESCRIPTION:${(e.description || '').replace(/\n/g, '\\n').replace(/[,;\\]/g, '')}`,
        `LOCATION:${(e.location || '').replace(/[,;\\]/g, '')}`,
      ];
      // RFC 5545: cancelled events keep their UID and carry STATUS:CANCELLED
      // so subscribers' calendars remove them on next sync.
      if (e.cancelled_at) block.push('STATUS:CANCELLED');
      block.push('END:VEVENT');
      lines.push(...block);
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
}
