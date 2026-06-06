import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';
import {
  CreateServiceDto,
  UpdateServiceDto,
  PingDto,
} from './dto/service.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  // ────────────────────────────────────────────────────────────────
  // Services CRUD (admin)
  // ────────────────────────────────────────────────────────────────

  async listServices(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM public.service_occurrences so
               WHERE so.service_id = s.id AND so.starts_at >= now()) AS upcoming_occurrence_count
       FROM public.services s
       WHERE s.tenant_id = $1
       ORDER BY s.is_active DESC, s.day_of_week ASC, s.start_time ASC`,
      [tenantId],
    );
    return rows.map((r: any) => this.mapService(r));
  }

  async createService(tenantId: string, actorId: string, dto: CreateServiceDto) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.services
         (tenant_id, name, day_of_week, start_time, end_time,
          latitude, longitude, radius_meters,
          late_threshold_minutes, early_leave_threshold_minutes,
          is_active, auto_push_enabled, push_message)
       VALUES ($1, $2, $3, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        tenantId,
        dto.name,
        dto.dayOfWeek,
        dto.startTime,
        dto.endTime,
        dto.latitude,
        dto.longitude,
        dto.radiusMeters ?? 800,
        dto.lateThresholdMinutes ?? 15,
        dto.earlyLeaveThresholdMinutes ?? 15,
        dto.isActive ?? true,
        dto.autoPushEnabled ?? true,
        dto.pushMessage ?? null,
      ],
    );

    await this.audit.log({
      action: 'service.created',
      resourceType: 'service',
      resourceId: row.id,
      summary: `Created service "${row.name}" (${this.dayName(row.day_of_week)} ${row.start_time}–${row.end_time})`,
      metadata: { name: row.name, dayOfWeek: row.day_of_week, radiusMeters: row.radius_meters },
    });

    return this.mapService(row);
  }

  async updateService(tenantId: string, serviceId: string, dto: UpdateServiceDto) {
    const sets: string[] = [];
    const params: any[] = [serviceId, tenantId];
    const map: Array<[keyof UpdateServiceDto, string, string?]> = [
      ['name', 'name'],
      ['dayOfWeek', 'day_of_week'],
      ['startTime', 'start_time', '::time'],
      ['endTime', 'end_time', '::time'],
      ['latitude', 'latitude'],
      ['longitude', 'longitude'],
      ['radiusMeters', 'radius_meters'],
      ['lateThresholdMinutes', 'late_threshold_minutes'],
      ['earlyLeaveThresholdMinutes', 'early_leave_threshold_minutes'],
      ['isActive', 'is_active'],
      ['autoPushEnabled', 'auto_push_enabled'],
      ['pushMessage', 'push_message'],
    ];
    for (const [dtoKey, col, cast] of map) {
      if ((dto as any)[dtoKey] !== undefined) {
        params.push((dto as any)[dtoKey]);
        sets.push(`${col} = $${params.length}${cast ?? ''}`);
      }
    }
    if (sets.length === 0) {
      throw new BadRequestException('No fields to update');
    }
    sets.push('updated_at = now()');

    const [row] = await this.dataSource.query(
      `UPDATE public.services SET ${sets.join(', ')}
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException('Service not found');

    await this.audit.log({
      action: 'service.updated',
      resourceType: 'service',
      resourceId: serviceId,
      summary: `Updated service "${row.name}"`,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.mapService(row);
  }

  async deleteService(tenantId: string, serviceId: string) {
    const [row] = await this.dataSource.query(
      `UPDATE public.services SET is_active = false, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING id, name`,
      [serviceId, tenantId],
    );
    if (!row) throw new NotFoundException('Service not found');

    await this.audit.log({
      action: 'service.deactivated',
      resourceType: 'service',
      resourceId: serviceId,
      summary: `Deactivated service "${row.name}"`,
      metadata: {},
    });
    return { deactivated: true };
  }

  // ────────────────────────────────────────────────────────────────
  // Opt-in (per user per tenant)
  // ────────────────────────────────────────────────────────────────

  async getOptIn(userId: string, tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT opted_in, opted_in_at, opted_out_at, updated_at
       FROM public.attendance_opt_in
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    // Upcoming occurrences are useful to render alongside the opt-in
    // toggle — "if you opt in, you'll be pinged at these times".
    const upcoming = await this.getUpcomingForMember(tenantId, 14);
    return {
      optedIn: row?.opted_in === true,
      optedInAt: row?.opted_in_at ?? null,
      optedOutAt: row?.opted_out_at ?? null,
      updatedAt: row?.updated_at ?? null,
      upcomingOccurrences: upcoming,
    };
  }

  async setOptIn(userId: string, tenantId: string, optedIn: boolean) {
    await this.dataSource.query(
      `INSERT INTO public.attendance_opt_in (user_id, tenant_id, opted_in, opted_in_at, opted_out_at)
       VALUES ($1, $2, $3,
               CASE WHEN $3 = true THEN now() ELSE NULL END,
               CASE WHEN $3 = false THEN now() ELSE NULL END)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET
         opted_in = EXCLUDED.opted_in,
         opted_in_at  = CASE WHEN $3 = true  THEN now() ELSE attendance_opt_in.opted_in_at  END,
         opted_out_at = CASE WHEN $3 = false THEN now() ELSE attendance_opt_in.opted_out_at END,
         updated_at = now()`,
      [userId, tenantId, optedIn],
    );
    return this.getOptIn(userId, tenantId);
  }

  // ────────────────────────────────────────────────────────────────
  // Ping (mobile-facing)
  // ────────────────────────────────────────────────────────────────

  async recordPing(userId: string, tenantId: string, dto: PingDto) {
    // Opt-in check. If the user hasn't opted in, we silently drop the
    // ping and tell the client. No row is written; no location data is
    // retained. Mirrors the pastor's "if they opt out, we don't track
    // anything" requirement.
    const [opt] = await this.dataSource.query(
      `SELECT opted_in FROM public.attendance_opt_in
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    if (!opt?.opted_in) {
      return { recorded: false, reason: 'not_opted_in' as const };
    }

    // Find an active service occurrence — meaning one that's in its
    // window NOW (with a small lead-in/lead-out buffer so a ping that
    // lands 5 min before start or after end still gets attached).
    const LEAD_MINUTES = 30;
    const [occ] = await this.dataSource.query(
      `SELECT so.id, s.latitude, s.longitude, s.radius_meters
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.tenant_id = $1
         AND so.is_cancelled = false
         AND so.starts_at - ($2::int || ' minutes')::interval <= now()
         AND so.ends_at   + ($2::int || ' minutes')::interval >= now()
       ORDER BY ABS(EXTRACT(EPOCH FROM (so.starts_at - now()))) ASC
       LIMIT 1`,
      [tenantId, LEAD_MINUTES],
    );

    // Distance + in_radius only computed if we found an occurrence with
    // configured geo. Pings outside a service window still land but
    // don't link to anything; the row is there if the user later
    // disputes attendance.
    let distance: number | null = null;
    let inRadius = false;
    if (occ?.latitude != null && occ?.longitude != null && occ?.radius_meters != null) {
      distance = this.haversineDistance(dto.lat, dto.lng, occ.latitude, occ.longitude);
      inRadius = distance <= occ.radius_meters;
    }

    const [row] = await this.dataSource.query(
      `INSERT INTO public.attendance_pings
         (user_id, tenant_id, service_occurrence_id, latitude, longitude,
          accuracy_meters, distance_meters, in_radius, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        tenantId,
        occ?.id ?? null,
        dto.lat,
        dto.lng,
        dto.accuracyMeters ?? null,
        distance,
        inRadius,
        dto.source ?? 'background',
      ],
    );

    return {
      recorded: true,
      pingId: row.id,
      serviceOccurrenceId: occ?.id ?? null,
      distance: distance != null ? Math.round(distance) : null,
      inRadius,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Upcoming occurrences (for member transparency screen)
  // ────────────────────────────────────────────────────────────────

  async getUpcomingForMember(tenantId: string, daysAhead = 14) {
    const rows = await this.dataSource.query(
      `SELECT so.id, so.occurrence_date, so.starts_at, so.ends_at,
              so.is_cancelled,
              s.name AS service_name, s.late_threshold_minutes, s.early_leave_threshold_minutes,
              s.radius_meters
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.tenant_id = $1
         AND so.starts_at BETWEEN now() AND now() + ($2::int || ' days')::interval
         AND s.is_active = true
       ORDER BY so.starts_at ASC`,
      [tenantId, daysAhead],
    );
    return rows.map((r: any) => ({
      occurrenceId: r.id,
      serviceName: r.service_name,
      occurrenceDate: r.occurrence_date,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      isCancelled: r.is_cancelled,
      lateThresholdMinutes: r.late_threshold_minutes,
      earlyLeaveThresholdMinutes: r.early_leave_threshold_minutes,
      radiusMeters: r.radius_meters,
    }));
  }

  // ────────────────────────────────────────────────────────────────
  // Admin: occurrence cancellation + attendance read
  // ────────────────────────────────────────────────────────────────

  async cancelOccurrence(tenantId: string, occurrenceId: string, actorId: string, reason?: string) {
    const [row] = await this.dataSource.query(
      `UPDATE public.service_occurrences
       SET is_cancelled = true, cancelled_at = now(), cancelled_by = $3
       WHERE id = $1 AND tenant_id = $2 AND is_cancelled = false
       RETURNING id, service_id, occurrence_date`,
      [occurrenceId, tenantId, actorId],
    );
    if (!row) throw new NotFoundException('Occurrence not found or already cancelled');

    await this.audit.log({
      action: 'service.occurrence_cancelled',
      resourceType: 'service',
      resourceId: row.service_id,
      summary: `Cancelled service occurrence on ${row.occurrence_date}`,
      metadata: { occurrenceId, reason: reason ?? null },
    });
    return { cancelled: true };
  }

  /**
   * Admin: attendance roster for a specific occurrence. One row per
   * opted-in member with their status + late/early flags + first/last
   * in-radius timestamps. Members without an opt-in are not listed
   * (we have no permission to know whether they attended).
   */
  async getOccurrenceAttendance(tenantId: string, occurrenceId: string) {
    const [occ] = await this.dataSource.query(
      `SELECT so.id, so.starts_at, so.ends_at, s.name AS service_name
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.id = $1 AND so.tenant_id = $2`,
      [occurrenceId, tenantId],
    );
    if (!occ) throw new NotFoundException('Occurrence not found');

    const rows = await this.dataSource.query(
      `SELECT sa.status, sa.was_late, sa.left_early, sa.first_in_radius_at,
              sa.last_in_radius_at, sa.ping_count,
              u.id AS user_id, u.full_name, u.avatar_url
       FROM public.service_attendance sa
       JOIN public.users u ON u.id = sa.user_id
       WHERE sa.service_occurrence_id = $1
       ORDER BY sa.status DESC, sa.was_late ASC, u.full_name ASC`,
      [occurrenceId],
    );

    return {
      occurrence: {
        id: occ.id,
        serviceName: occ.service_name,
        startsAt: occ.starts_at,
        endsAt: occ.ends_at,
      },
      counts: {
        total: rows.length,
        present: rows.filter((r: any) => r.status === 'present').length,
        absent: rows.filter((r: any) => r.status === 'absent').length,
        late: rows.filter((r: any) => r.was_late).length,
        leftEarly: rows.filter((r: any) => r.left_early).length,
      },
      attendees: rows.map((r: any) => ({
        userId: r.user_id,
        fullName: r.full_name,
        avatarUrl: r.avatar_url,
        status: r.status,
        wasLate: r.was_late,
        leftEarly: r.left_early,
        firstInRadiusAt: r.first_in_radius_at,
        lastInRadiusAt: r.last_in_radius_at,
        pingCount: r.ping_count,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Scheduled jobs (called from AttendanceScheduler)
  // ────────────────────────────────────────────────────────────────

  /**
   * Nightly job: generate service_occurrences rows for the next 30
   * days. Idempotent — UNIQUE(service_id, occurrence_date) on the table
   * means re-running just no-ops on existing rows. Holiday cancellations
   * survive because we don't touch is_cancelled / cancelled_at.
   */
  async generateUpcomingOccurrences(daysAhead = 30): Promise<{ generated: number }> {
    // Query is intentionally a single set-based INSERT so we don't
    // round-trip per service. Uses generate_series in tenant TZ to walk
    // the next N days, picks days matching service.day_of_week, builds
    // the local timestamp + casts to UTC via the tenant timezone.
    const result = await this.dataSource.query(
      `WITH days AS (
         SELECT s.id AS service_id,
                s.tenant_id,
                s.day_of_week,
                s.start_time,
                s.end_time,
                t.timezone AS tz,
                d::date AS local_date
         FROM public.services s
         JOIN public.tenants t ON t.id = s.tenant_id
         CROSS JOIN LATERAL generate_series(
           (now() AT TIME ZONE t.timezone)::date,
           ((now() + ($1::int || ' days')::interval) AT TIME ZONE t.timezone)::date,
           interval '1 day'
         ) AS d
         WHERE s.is_active = true
           AND s.end_time IS NOT NULL
           AND s.latitude IS NOT NULL
           AND s.longitude IS NOT NULL
           AND s.radius_meters IS NOT NULL
           AND EXTRACT(DOW FROM d) = s.day_of_week
       )
       INSERT INTO public.service_occurrences
         (service_id, tenant_id, occurrence_date, starts_at, ends_at)
       SELECT
         service_id, tenant_id, local_date,
         (local_date + start_time) AT TIME ZONE tz,
         (local_date + end_time)   AT TIME ZONE tz
       FROM days
       ON CONFLICT (service_id, occurrence_date) DO NOTHING
       RETURNING id`,
      [daysAhead],
    );
    return { generated: result.length };
  }

  /**
   * Per-minute tick: find any occurrence whose start_at is within the
   * next 60 seconds and whose start_push hasn't fired. For each, push
   * a silent-ish broadcast to every opted-in member of the tenant
   * asking the app to send a ping. The app handles the silent push by
   * waking up, capturing location, and POSTing to /attendance/ping.
   *
   * "Silent-ish" — visible notification with the service name. Pastor's
   * spec wanted automatic; we don't have to ALERT, but a tiny visible
   * "Marking you present at <church>" string is the right transparency
   * trade-off and helps users notice if they want to opt out.
   */
  async fireStartPushes(): Promise<{ pushed: number }> {
    const occurrences = await this.dataSource.query(
      `SELECT so.id, so.tenant_id, s.name AS service_name, s.auto_push_enabled,
              s.push_message
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.is_cancelled = false
         AND so.start_push_sent_at IS NULL
         AND so.starts_at <= now() + interval '60 seconds'
         AND so.starts_at >= now() - interval '5 minutes'`,
    );
    if (occurrences.length === 0) return { pushed: 0 };

    let pushed = 0;
    for (const occ of occurrences) {
      // Lock the row first so two scheduler ticks can't both fire.
      const locked = await this.dataSource.query(
        `UPDATE public.service_occurrences
         SET start_push_sent_at = now()
         WHERE id = $1 AND start_push_sent_at IS NULL
         RETURNING id`,
        [occ.id],
      );
      if (locked.length === 0) continue;

      if (!occ.auto_push_enabled) {
        this.logger.log(`Skipping auto-push for occurrence ${occ.id} — auto_push_enabled=false`);
        continue;
      }

      // Pull all opted-in members of the tenant.
      const recipients = await this.dataSource.query(
        `SELECT user_id FROM public.attendance_opt_in
         WHERE tenant_id = $1 AND opted_in = true`,
        [occ.tenant_id],
      );
      if (recipients.length === 0) {
        this.logger.log(`Occurrence ${occ.id}: no opted-in members; skipping push`);
        continue;
      }

      const body = occ.push_message ??
        `Marking you present at ${occ.service_name}. Make sure location is on.`;

      await this.notificationsQueue.add('auto_attendance_push', {
        type: 'church_broadcast',
        tenantId: occ.tenant_id,
        recipientIds: recipients.map((r: any) => r.user_id),
        title: occ.service_name,
        body,
        // sourceId for dedupe: per-occurrence + recipient
        sourceId: occ.id,
        // Canonical mobile payload schema. Keep keys stable — the
        // mobile pings hard-validate kind === 'auto_attendance_ping'
        // and branch on phase. tenantId lets a multi-church-member
        // client confirm the push is for the right context.
        data: {
          kind: 'auto_attendance_ping',
          phase: 'start' as const,
          serviceOccurrenceId: occ.id,
          tenantId: occ.tenant_id,
        },
      });
      pushed += recipients.length;
      this.logger.log(`Auto-attendance push enqueued for occurrence ${occ.id} → ${recipients.length} recipients`);
    }
    return { pushed };
  }

  /**
   * Per-minute tick: find any occurrence whose ends_at -
   * end_push_lead_minutes is now (or in the next 60s) and that hasn't
   * had its end-push fired. Sends a second silent broadcast asking
   * phones for a fresh location so the sweep at end + 5 min has
   * up-to-date data to detect early leavers.
   *
   * "Per minute" is the tick — actual push fires ONCE per occurrence
   * because end_push_sent_at locks it after the first fire.
   */
  async fireEndPushes(): Promise<{ pushed: number }> {
    const occurrences = await this.dataSource.query(
      `SELECT so.id, so.tenant_id, s.name AS service_name, s.auto_push_enabled,
              s.end_push_lead_minutes
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.is_cancelled = false
         AND so.end_push_sent_at IS NULL
         AND so.start_push_sent_at IS NOT NULL
         AND so.ends_at - (s.end_push_lead_minutes::text || ' minutes')::interval <= now() + interval '60 seconds'
         AND so.ends_at - (s.end_push_lead_minutes::text || ' minutes')::interval >= now() - interval '5 minutes'`,
    );
    if (occurrences.length === 0) return { pushed: 0 };

    let pushed = 0;
    for (const occ of occurrences) {
      const locked = await this.dataSource.query(
        `UPDATE public.service_occurrences
         SET end_push_sent_at = now()
         WHERE id = $1 AND end_push_sent_at IS NULL
         RETURNING id`,
        [occ.id],
      );
      if (locked.length === 0) continue;
      if (!occ.auto_push_enabled) continue;

      const recipients = await this.dataSource.query(
        `SELECT user_id FROM public.attendance_opt_in
         WHERE tenant_id = $1 AND opted_in = true`,
        [occ.tenant_id],
      );
      if (recipients.length === 0) continue;

      await this.notificationsQueue.add('auto_attendance_push', {
        type: 'church_broadcast',
        tenantId: occ.tenant_id,
        recipientIds: recipients.map((r: any) => r.user_id),
        title: `${occ.service_name} — wrapping up`,
        body: 'Final attendance check. Thanks for being with us today.',
        sourceId: `end:${occ.id}`,
        data: {
          kind: 'auto_attendance_ping',
          phase: 'end' as const,
          serviceOccurrenceId: occ.id,
          tenantId: occ.tenant_id,
        },
      });
      pushed += recipients.length;
    }
    return { pushed };
  }

  /**
   * Per-minute tick: find any occurrence whose end_at + 5 min is in the
   * past and that hasn't been swept. For each, compute attendance per
   * opted-in member based on their pings.
   *
   * Status rules:
   *   - in_radius pings ≥ 1 → present (else absent)
   *   - first in_radius ping > start + late_threshold_minutes → was_late
   *   - last in_radius ping < end - early_leave_threshold_minutes → left_early
   */
  async sweepEndedOccurrences(): Promise<{ swept: number }> {
    const SWEEP_LAG_MINUTES = 5;
    const occurrences = await this.dataSource.query(
      `SELECT so.id, so.tenant_id, so.starts_at, so.ends_at,
              s.late_threshold_minutes, s.early_leave_threshold_minutes
       FROM public.service_occurrences so
       JOIN public.services s ON s.id = so.service_id
       WHERE so.is_cancelled = false
         AND so.swept_at IS NULL
         AND so.ends_at + ($1::int || ' minutes')::interval <= now()
       LIMIT 50`,
      [SWEEP_LAG_MINUTES],
    );

    let swept = 0;
    for (const occ of occurrences) {
      const lockedRows = await this.dataSource.query(
        `UPDATE public.service_occurrences
         SET swept_at = now()
         WHERE id = $1 AND swept_at IS NULL
         RETURNING id`,
        [occ.id],
      );
      if (lockedRows.length === 0) continue;

      await this.computeOccurrenceAttendance(
        occ.id,
        occ.tenant_id,
        occ.starts_at,
        occ.ends_at,
        occ.late_threshold_minutes,
        occ.early_leave_threshold_minutes,
      );
      swept++;
    }
    return { swept };
  }

  /**
   * Compute and insert service_attendance rows for one occurrence.
   * One row per opted-in member of the tenant.
   */
  private async computeOccurrenceAttendance(
    occurrenceId: string,
    tenantId: string,
    startsAt: Date,
    endsAt: Date,
    lateThresholdMinutes: number,
    earlyLeaveThresholdMinutes: number,
  ): Promise<void> {
    // For each opted-in member: count pings + find first/last in_radius
    // timestamps + decide present/absent + late/early flags. Done in
    // one set-based INSERT.
    const lateBoundary = new Date(startsAt.getTime() + lateThresholdMinutes * 60_000);
    const earlyBoundary = new Date(endsAt.getTime() - earlyLeaveThresholdMinutes * 60_000);

    await this.dataSource.query(
      `INSERT INTO public.service_attendance
         (service_occurrence_id, user_id, tenant_id, status, was_late, left_early,
          first_in_radius_at, last_in_radius_at, ping_count)
       SELECT
         $1::uuid,
         o.user_id,
         $2::uuid,
         CASE WHEN agg.in_radius_count > 0 THEN 'present' ELSE 'absent' END,
         (agg.first_in_radius IS NOT NULL AND agg.first_in_radius > $5::timestamptz),
         (agg.last_in_radius  IS NOT NULL AND agg.last_in_radius  < $6::timestamptz),
         agg.first_in_radius,
         agg.last_in_radius,
         agg.in_radius_count
       FROM public.attendance_opt_in o
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE in_radius)::int AS in_radius_count,
           MIN(recorded_at) FILTER (WHERE in_radius) AS first_in_radius,
           MAX(recorded_at) FILTER (WHERE in_radius) AS last_in_radius
         FROM public.attendance_pings p
         WHERE p.service_occurrence_id = $1 AND p.user_id = o.user_id
       ) agg ON true
       WHERE o.tenant_id = $2 AND o.opted_in = true
       ON CONFLICT (service_occurrence_id, user_id) DO UPDATE SET
         status              = EXCLUDED.status,
         was_late            = EXCLUDED.was_late,
         left_early          = EXCLUDED.left_early,
         first_in_radius_at  = EXCLUDED.first_in_radius_at,
         last_in_radius_at   = EXCLUDED.last_in_radius_at,
         ping_count          = EXCLUDED.ping_count,
         computed_at         = now()`,
      [occurrenceId, tenantId, null, null, lateBoundary.toISOString(), earlyBoundary.toISOString()],
    );

    // Also emit a single audit row capturing the sweep — useful when
    // a member disputes "I wasn't there" later.
    const [counts] = await this.dataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'present')::int AS present_count,
         COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_count,
         COUNT(*) FILTER (WHERE was_late)::int AS late_count,
         COUNT(*) FILTER (WHERE left_early)::int AS early_count
       FROM public.service_attendance WHERE service_occurrence_id = $1`,
      [occurrenceId],
    );

    this.logger.log(
      `Swept occurrence ${occurrenceId}: present=${counts.present_count} absent=${counts.absent_count} late=${counts.late_count} early=${counts.early_count}`,
    );
  }

  // ────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────

  private mapService(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      latitude: r.latitude,
      longitude: r.longitude,
      radiusMeters: r.radius_meters,
      lateThresholdMinutes: r.late_threshold_minutes,
      earlyLeaveThresholdMinutes: r.early_leave_threshold_minutes,
      isActive: r.is_active,
      autoPushEnabled: r.auto_push_enabled,
      pushMessage: r.push_message,
      upcomingOccurrenceCount: r.upcoming_occurrence_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private dayName(dow: number): string {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] ?? 'Unknown';
  }

  /** Haversine distance in meters. Same impl as leaderboard.service. */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
