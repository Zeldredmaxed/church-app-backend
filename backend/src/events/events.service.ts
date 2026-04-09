import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Event } from './entities/event.entity';
import { EventRsvp } from './entities/event-rsvp.entity';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
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
    return queryRunner.manager.save(Event, event);
  }

  async updateEvent(id: string, dto: Partial<CreateEventDto>) {
    const { queryRunner } = this.getRlsContext();
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
    return queryRunner.manager.findOneOrFail(Event, { where: { id } });
  }

  async deleteEvent(id: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.manager.delete(Event, { id });
    if (result.affected === 0) throw new NotFoundException('Event not found');
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
      createdAt: r.created_at,
    };
  }
}
