import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { LogHoursDto } from './dto/log-hours.dto';
import { AuditService } from '../audit/audit.service';
import { ProfileCompletenessService } from '../users/profile-completeness.service';

@Injectable()
export class VolunteerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly completeness: ProfileCompletenessService,
  ) {}

  private async resolveName(userId: string): Promise<string> {
    const [r] = await this.dataSource.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [userId],
    );
    return r?.full_name ?? 'Admin';
  }

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getOpportunities(userId: string, limit: number) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT o.*,
        EXISTS(SELECT 1 FROM public.volunteer_signups vs WHERE vs.opportunity_id = o.id AND vs.user_id = $2) AS is_signed_up
      FROM public.volunteer_opportunities o
      ORDER BY o.created_at DESC
      LIMIT $1`,
      [limit, userId],
    );

    return {
      opportunities: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        roleName: r.role_name,
        description: r.description,
        schedule: r.schedule,
        spotsAvailable: r.spots_available,
        isSignedUp: r.is_signed_up,
        createdAt: r.created_at,
      })),
    };
  }

  async signup(opportunityId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    // Profile-completeness gate. The church needs to be able to reach
    // volunteers — without phone + email + address the church can't
    // notify them about shift changes, send T-shirts, or run a
    // background check. The 400 carries a structured `missing` array
    // so the mobile can render a "Complete your profile" sheet that
    // routes the user to the right setting.
    await this.completeness.require(userId, 'volunteer');

    await queryRunner.query(
      `INSERT INTO public.volunteer_signups (opportunity_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [opportunityId, userId],
    );
    return { message: 'Signed up successfully' };
  }

  /**
   * Returns volunteer KPI metrics for the dashboard.
   * Uses service-role DataSource.
   */
  async getVolunteerKpis(tenantId: string) {
    // Only VERIFIED hours count toward KPIs — pending self-reported
    // rows are surfaced separately via listPendingVerification.
    const rows = await this.dataSource.query(
      `SELECT
        COUNT(DISTINCT vs.user_id)::int AS active_volunteers,
        COALESCE(SUM(vh.hours), 0)::float AS hours_this_month,
        (SELECT COUNT(*)::int FROM public.volunteer_hours
         WHERE tenant_id = $1 AND verified_by IS NULL) AS pending_verification_count
       FROM public.volunteer_signups vs
       JOIN public.volunteer_opportunities vo ON vo.id = vs.opportunity_id AND vo.tenant_id = $1
       LEFT JOIN public.volunteer_hours vh
         ON vh.user_id = vs.user_id
         AND vh.tenant_id = $1
         AND vh.date >= date_trunc('month', now())
         AND vh.verified_by IS NOT NULL`,
      [tenantId],
    );

    const row = rows[0] ?? {};
    return {
      activeVolunteers: row.active_volunteers ?? 0,
      hoursThisMonth: row.hours_this_month ?? 0,
      pendingVerificationCount: row.pending_verification_count ?? 0,
    };
  }

  async listPendingVerification(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT vh.id, vh.user_id, vh.opportunity_id, vh.hours, vh.date, vh.notes, vh.created_at,
              u.full_name, u.avatar_url,
              vo.role_name AS opportunity_name
       FROM public.volunteer_hours vh
       LEFT JOIN public.users u ON u.id = vh.user_id
       LEFT JOIN public.volunteer_opportunities vo ON vo.id = vh.opportunity_id
       WHERE vh.tenant_id = $1 AND vh.verified_by IS NULL
       ORDER BY vh.created_at DESC LIMIT 200`,
      [tenantId],
    );
    return {
      pending: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        userFullName: r.full_name,
        userAvatarUrl: r.avatar_url,
        opportunityId: r.opportunity_id,
        opportunityName: r.opportunity_name,
        hours: parseFloat(r.hours),
        date: r.date,
        notes: r.notes,
        createdAt: r.created_at,
      })),
      count: rows.length,
    };
  }

  async verifyHours(tenantId: string, hoursId: string, adminId: string, reason?: string) {
    const result = await this.dataSource.query(
      `UPDATE public.volunteer_hours
       SET verified_by = $2, verified_at = now(), verification_reason = $3
       WHERE id = $1 AND tenant_id = $4 AND verified_by IS NULL
       RETURNING id, user_id, hours, opportunity_id`,
      [hoursId, adminId, reason ?? null, tenantId],
    );
    if (result.length === 0) {
      throw new NotFoundException('Hours row not found or already verified');
    }
    const row = result[0];
    await this.audit.log({
      action: 'volunteer.hours_verified',
      resourceType: 'volunteer_hours',
      resourceId: hoursId,
      targetUserId: row.user_id,
      summary: `${await this.resolveName(adminId)} verified ${row.hours} volunteer hour(s)`,
      metadata: { hoursId, hours: row.hours, opportunityId: row.opportunity_id, reason },
    });
    return { verified: true };
  }

  async rejectHours(tenantId: string, hoursId: string, adminId: string, reason?: string) {
    const before = await this.dataSource.query(
      `SELECT user_id, hours, opportunity_id, notes
       FROM public.volunteer_hours
       WHERE id = $1 AND tenant_id = $2`,
      [hoursId, tenantId],
    );
    if (before.length === 0) throw new NotFoundException('Hours row not found');
    const row = before[0];

    await this.dataSource.query(
      `DELETE FROM public.volunteer_hours WHERE id = $1 AND tenant_id = $2`,
      [hoursId, tenantId],
    );

    await this.audit.log({
      action: 'volunteer.hours_rejected',
      resourceType: 'volunteer_hours',
      resourceId: hoursId,
      targetUserId: row.user_id,
      summary: `${await this.resolveName(adminId)} rejected ${row.hours} volunteer hour(s)`,
      metadata: { hoursId, hours: row.hours, opportunityId: row.opportunity_id, reason, originalNotes: row.notes },
    });
    return { rejected: true };
  }

  /**
   * Logs volunteer hours.
   * Uses service-role DataSource.
   */
  async logHours(tenantId: string, dto: LogHoursDto) {
    const rows = await this.dataSource.query(
      `INSERT INTO public.volunteer_hours (tenant_id, user_id, opportunity_id, hours, date, notes)
       VALUES ($1, $2, $3::uuid, $4, $5, $6)
       RETURNING id, tenant_id, user_id, opportunity_id, hours, date, notes, created_at`,
      [tenantId, dto.userId, dto.opportunityId ?? null, dto.hours, dto.date, dto.notes ?? null],
    );

    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      opportunityId: r.opportunity_id,
      hours: parseFloat(r.hours),
      date: r.date,
      notes: r.notes,
      createdAt: r.created_at,
    };
  }

  /**
   * Returns the volunteer schedule with assigned volunteers.
   * Uses service-role DataSource.
   */
  async getSchedule(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT vo.id, vo.role_name, vo.schedule,
        json_agg(json_build_object('userId', u.id, 'fullName', u.full_name)) AS volunteers
       FROM public.volunteer_opportunities vo
       JOIN public.volunteer_signups vs ON vs.opportunity_id = vo.id
       JOIN public.users u ON u.id = vs.user_id
       WHERE vo.tenant_id = $1
       GROUP BY vo.id
       ORDER BY vo.role_name`,
      [tenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      roleName: r.role_name,
      schedule: r.schedule,
      volunteers: r.volunteers,
    }));
  }
}
