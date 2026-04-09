import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class FacilitiesService {
  private readonly logger = new Logger(FacilitiesService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * List all rooms for a tenant with current availability status.
   */
  async getRooms(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT r.*,
        NOT EXISTS(
          SELECT 1 FROM public.room_bookings rb
          WHERE rb.room_id = r.id AND rb.status = 'confirmed'
            AND rb.start_at <= now() AND rb.end_at > now()
        ) AS is_available
       FROM public.rooms r
       WHERE r.tenant_id = $1 AND r.is_active = true
       ORDER BY r.name`,
      [tenantId],
    );

    return {
      rooms: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        capacity: r.capacity,
        description: r.description,
        amenities: r.amenities,
        isActive: r.is_active,
        isAvailable: r.is_available,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Get bookings for a room in a date range.
   */
  async getRoomCalendar(tenantId: string, roomId: string, startDate: string, endDate: string) {
    const rows = await this.dataSource.query(
      `SELECT rb.*, u.full_name AS booked_by_name
       FROM public.room_bookings rb
       JOIN public.users u ON u.id = rb.booked_by
       WHERE rb.tenant_id = $1 AND rb.room_id = $2
         AND rb.start_at < $4::timestamptz AND rb.end_at > $3::timestamptz
         AND rb.status = 'confirmed'
       ORDER BY rb.start_at`,
      [tenantId, roomId, startDate, endDate],
    );

    return {
      bookings: rows.map((r: any) => ({
        id: r.id,
        roomId: r.room_id,
        title: r.title,
        bookedBy: r.booked_by,
        bookedByName: r.booked_by_name,
        startAt: r.start_at,
        endAt: r.end_at,
        notes: r.notes,
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Create a booking after checking for conflicts.
   */
  async createBooking(tenantId: string, dto: CreateBookingDto, userId: string) {
    // Check for overlapping confirmed bookings
    const conflicts = await this.dataSource.query(
      `SELECT id FROM public.room_bookings
       WHERE room_id = $1 AND status = 'confirmed'
         AND start_at < $3::timestamptz AND end_at > $2::timestamptz
       LIMIT 1`,
      [dto.roomId, dto.startAt, dto.endAt],
    );

    if (conflicts.length > 0) {
      throw new ConflictException('Room is already booked for the requested time slot');
    }

    const [row] = await this.dataSource.query(
      `INSERT INTO public.room_bookings (tenant_id, room_id, title, booked_by, start_at, end_at, notes)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7)
       RETURNING *`,
      [tenantId, dto.roomId, dto.title, userId, dto.startAt, dto.endAt, dto.notes ?? null],
    );

    return this.mapBooking(row);
  }

  /**
   * Partial update of a booking.
   */
  async updateBooking(tenantId: string, id: string, dto: Partial<CreateBookingDto>) {
    const sets: string[] = [];
    const params: any[] = [tenantId, id];

    if (dto.title !== undefined) {
      params.push(dto.title);
      sets.push(`title = $${params.length}`);
    }
    if (dto.startAt !== undefined) {
      params.push(dto.startAt);
      sets.push(`start_at = $${params.length}::timestamptz`);
    }
    if (dto.endAt !== undefined) {
      params.push(dto.endAt);
      sets.push(`end_at = $${params.length}::timestamptz`);
    }
    if (dto.notes !== undefined) {
      params.push(dto.notes);
      sets.push(`notes = $${params.length}`);
    }

    if (sets.length === 0) {
      throw new NotFoundException('No fields to update');
    }

    const rows = await this.dataSource.query(
      `UPDATE public.room_bookings SET ${sets.join(', ')}
       WHERE tenant_id = $1 AND id = $2 AND status = 'confirmed'
       RETURNING *`,
      params,
    );

    if (!rows.length) throw new NotFoundException('Booking not found');
    return this.mapBooking(rows[0]);
  }

  /**
   * Cancel a booking (soft delete).
   */
  async cancelBooking(tenantId: string, id: string) {
    const rows = await this.dataSource.query(
      `UPDATE public.room_bookings SET status = 'cancelled'
       WHERE tenant_id = $1 AND id = $2 AND status = 'confirmed'
       RETURNING *`,
      [tenantId, id],
    );

    if (!rows.length) throw new NotFoundException('Booking not found or already cancelled');
    return this.mapBooking(rows[0]);
  }

  /**
   * Get hourly availability slots (6am-10pm) for a room on a given day.
   */
  async getAvailability(tenantId: string, roomId: string, date: string) {
    // Get all confirmed bookings for this room on this date
    const dayStart = `${date}T06:00:00`;
    const dayEnd = `${date}T22:00:00`;

    const bookings = await this.dataSource.query(
      `SELECT start_at, end_at FROM public.room_bookings
       WHERE tenant_id = $1 AND room_id = $2 AND status = 'confirmed'
         AND start_at < $4::timestamptz AND end_at > $3::timestamptz
       ORDER BY start_at`,
      [tenantId, roomId, dayStart, dayEnd],
    );

    // Generate hourly slots 6am-10pm (16 slots)
    const slots: { start: string; end: string; available: boolean }[] = [];
    for (let hour = 6; hour < 22; hour++) {
      const slotStart = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00Z`);
      const slotEnd = new Date(`${date}T${(hour + 1).toString().padStart(2, '0')}:00:00Z`);

      const isBooked = bookings.some((b: any) => {
        const bStart = new Date(b.start_at);
        const bEnd = new Date(b.end_at);
        return bStart < slotEnd && bEnd > slotStart;
      });

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: !isBooked,
      });
    }

    return { roomId, date, slots };
  }

  private mapBooking(r: any) {
    return {
      id: r.id,
      roomId: r.room_id,
      tenantId: r.tenant_id,
      title: r.title,
      bookedBy: r.booked_by,
      startAt: r.start_at,
      endAt: r.end_at,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
