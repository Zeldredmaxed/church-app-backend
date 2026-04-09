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
   * Care summary — counts of care cases by status.
   */
  async getCareSummary(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(CASE WHEN status = 'new' THEN 1 END)::int AS new_cases,
         COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int AS in_progress,
         COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int AS resolved,
         COUNT(CASE WHEN status = 'needs_leader' THEN 1 END)::int AS needs_leader
       FROM public.care_cases WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      newCases: row.new_cases,
      inProgress: row.in_progress,
      resolved: row.resolved,
      needsLeader: row.needs_leader,
    };
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
   * Member engagement metrics — weekly active members and trend.
   *
   * "Active" = distinct user who performed at least one action in that week:
   * posted, commented, liked, checked in, gave, joined a group, prayed,
   * RSVP'd, or sent a message.
   *
   * Returns current + previous week comparison, delta, trend, and 6-week history.
   */
  async getEngagement(tenantId: string) {
    // Get 6 weeks of engagement data using a CTE that unions all activity tables
    const rows: Array<{ week_start: string; active_members: string; total_members: string }> =
      await this.dataSource.query(
        `WITH weeks AS (
           SELECT generate_series(
             date_trunc('week', now()) - interval '5 weeks',
             date_trunc('week', now()),
             '1 week'::interval
           )::date AS week_start
         ),
         activity AS (
           SELECT author_id AS user_id, created_at FROM public.posts WHERE tenant_id = $1
           UNION ALL
           SELECT author_id, created_at FROM public.comments WHERE tenant_id = $1
           UNION ALL
           SELECT user_id, created_at FROM public.post_likes WHERE tenant_id = $1
           UNION ALL
           SELECT user_id, checked_in_at FROM public.check_ins WHERE tenant_id = $1
           UNION ALL
           SELECT user_id, created_at FROM public.transactions WHERE tenant_id = $1 AND status = 'succeeded'
           UNION ALL
           SELECT user_id, joined_at FROM public.group_members gm
             WHERE gm.group_id IN (SELECT id FROM public.groups WHERE tenant_id = $1)
           UNION ALL
           SELECT author_id, created_at FROM public.prayers WHERE tenant_id = $1
           UNION ALL
           SELECT user_id, created_at FROM public.event_rsvps er
             WHERE er.event_id IN (SELECT id FROM public.events WHERE tenant_id = $1)
           UNION ALL
           SELECT author_id, created_at FROM public.group_messages gm2
             WHERE gm2.group_id IN (SELECT id FROM public.groups WHERE tenant_id = $1)
         ),
         weekly_active AS (
           SELECT w.week_start,
             COUNT(DISTINCT a.user_id)::int AS active_members
           FROM weeks w
           LEFT JOIN activity a
             ON a.created_at >= w.week_start
             AND a.created_at < w.week_start + interval '1 week'
           GROUP BY w.week_start
         ),
         weekly_total AS (
           SELECT w.week_start,
             (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1) AS total_members
           FROM weeks w
         )
         SELECT wa.week_start, wa.active_members, wt.total_members
         FROM weekly_active wa
         JOIN weekly_total wt ON wt.week_start = wa.week_start
         ORDER BY wa.week_start ASC`,
        [tenantId],
      );

    const weeklyHistory = rows.map(r => {
      const active = Number(r.active_members);
      const total = Number(r.total_members);
      return {
        weekStart: r.week_start,
        activeMembers: active,
        totalMembers: total,
        engagementPercent: total > 0 ? Math.round((active / total) * 1000) / 10 : 0,
      };
    });

    // Pad to exactly 6 entries if needed
    while (weeklyHistory.length < 6) {
      weeklyHistory.unshift({ weekStart: '', activeMembers: 0, totalMembers: 0, engagementPercent: 0 });
    }

    const currentWeek = weeklyHistory[weeklyHistory.length - 1];
    const previousWeek = weeklyHistory[weeklyHistory.length - 2];
    const delta = Math.round((currentWeek.engagementPercent - previousWeek.engagementPercent) * 10) / 10;

    return {
      currentWeek,
      previousWeek,
      delta,
      trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      weeklyHistory,
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
