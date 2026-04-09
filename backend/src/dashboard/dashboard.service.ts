import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns all 7 KPI cards for the admin dashboard in a single call.
   * Uses service-role connection (not RLS) since it aggregates across the tenant.
   */
  async getKpis(tenantId: string) {
    const [
      [{ total_members }],
      [{ new_members_this_month }],
      [{ total_giving_this_month }],
      [{ active_groups }],
      [{ total_prayers }],
      [{ active_volunteers }],
      [{ pending_prayers }],
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total_members FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS new_members_this_month
         FROM public.tenant_memberships
         WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total_giving_this_month
         FROM public.transactions
         WHERE tenant_id = $1 AND status = 'succeeded' AND created_at >= date_trunc('month', now())`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS active_groups FROM public.groups WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total_prayers FROM public.prayers WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT vs.user_id)::int AS active_volunteers
         FROM public.volunteer_signups vs
         WHERE vs.opportunity_id IN (SELECT id FROM public.volunteer_opportunities WHERE tenant_id = $1)`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS pending_prayers
         FROM public.prayers WHERE tenant_id = $1 AND is_answered = false`,
        [tenantId],
      ),
    ]);

    return {
      totalMembers: total_members,
      newMembersThisMonth: new_members_this_month,
      totalGivingThisMonth: total_giving_this_month,
      activeGroups: active_groups,
      totalPrayers: total_prayers,
      activeVolunteers: active_volunteers,
      pendingPrayers: pending_prayers,
    };
  }

  /**
   * Monthly giving totals for the giving chart.
   * Range: '6m' | '12m' | '24m'
   */
  async getGivingChart(tenantId: string, range: '6m' | '12m' | '24m') {
    const intervalMap: Record<string, string> = {
      '6m': '6 months',
      '12m': '12 months',
      '24m': '24 months',
    };
    const interval = intervalMap[range] ?? '6 months';

    const rows = await this.dataSource.query(
      `SELECT date_trunc('month', created_at)::date AS month, SUM(amount)::float AS total
       FROM public.transactions
       WHERE tenant_id = $1 AND status = 'succeeded' AND created_at >= now() - $2::interval
       GROUP BY 1 ORDER BY 1`,
      [tenantId, interval],
    );

    return { data: rows.map((r: any) => ({ month: r.month, total: r.total })) };
  }

  /**
   * Weekly check-in counts for the last 12 weeks.
   */
  async getAttendanceChart(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT date_trunc('week', checked_in_at)::date AS week, COUNT(*)::int AS count
       FROM public.check_ins
       WHERE tenant_id = $1 AND checked_in_at >= now() - interval '12 weeks'
       GROUP BY 1 ORDER BY 1`,
      [tenantId],
    );

    return { data: rows.map((r: any) => ({ week: r.week, count: r.count })) };
  }

  /**
   * Monthly new member counts for the growth chart.
   */
  async getGrowthChart(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT date_trunc('month', created_at)::date AS month, COUNT(*)::int AS count
       FROM public.tenant_memberships
       WHERE tenant_id = $1
       GROUP BY 1 ORDER BY 1`,
      [tenantId],
    );

    return { data: rows.map((r: any) => ({ month: r.month, count: r.count })) };
  }

  /**
   * Care summary — placeholder until the care_cases module is built.
   * TODO: Populate from care_cases table when the Care module is implemented.
   */
  async getCareSummary(_tenantId: string) {
    return { newCases: 0, inProgress: 0, resolved: 0, needsLeader: 0 };
  }

  /**
   * Upcoming events for the dashboard widget.
   */
  async getUpcomingEvents(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, title, description, start_at, end_at, location
       FROM public.events
       WHERE tenant_id = $1 AND start_at >= now()
       ORDER BY start_at ASC LIMIT 5`,
      [tenantId],
    );

    return {
      events: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        startAt: r.start_at,
        endAt: r.end_at,
        location: r.location,
      })),
    };
  }

  /**
   * Union of recent activity across posts, events, prayers, and announcements.
   */
  async getActivityFeed(tenantId: string, limit: number) {
    const rows = await this.dataSource.query(
      `(SELECT 'post' AS type, id, content AS title, created_at FROM public.posts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'event' AS type, id, title, created_at FROM public.events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'prayer' AS type, id, content AS title, created_at FROM public.prayers WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'announcement' AS type, id, title, created_at FROM public.announcements WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5)
       ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );

    return {
      items: rows.map((r: any) => ({
        type: r.type,
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
      })),
    };
  }
}
