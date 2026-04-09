import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { LogHoursDto } from './dto/log-hours.dto';

@Injectable()
export class VolunteerService {
  constructor(private readonly dataSource: DataSource) {}

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
    const rows = await this.dataSource.query(
      `SELECT
        COUNT(DISTINCT vs.user_id)::int AS active_volunteers,
        COALESCE(SUM(vh.hours), 0)::float AS hours_this_month
       FROM public.volunteer_signups vs
       JOIN public.volunteer_opportunities vo ON vo.id = vs.opportunity_id AND vo.tenant_id = $1
       LEFT JOIN public.volunteer_hours vh ON vh.user_id = vs.user_id AND vh.tenant_id = $1 AND vh.date >= date_trunc('month', now())`,
      [tenantId],
    );

    const row = rows[0] ?? {};
    return {
      activeVolunteers: row.active_volunteers ?? 0,
      hoursThisMonth: row.hours_this_month ?? 0,
    };
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
