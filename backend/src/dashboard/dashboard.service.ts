import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../common/services/cache.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  /**
   * Returns all 7 KPI cards for the admin dashboard in a single call.
   * Uses service-role connection (not RLS) since it aggregates across the tenant.
   */
  async getKpis(tenantId: string) {
    return this.cache.wrap(`dashboard:kpis:${tenantId}`, 30, () => this._getKpis(tenantId));
  }

  private async _getKpis(tenantId: string) {
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
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
         INNER JOIN public.volunteer_opportunities vo ON vo.id = vs.opportunity_id
         WHERE vo.tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS pending_prayers
         FROM public.prayers WHERE tenant_id = $1 AND is_answered = false`,
        [tenantId],
      ),
    ]);

    return {
      totalMembers: r1[0]?.total_members ?? 0,
      newMembersThisMonth: r2[0]?.new_members_this_month ?? 0,
      totalGivingThisMonth: r3[0]?.total_giving_this_month ?? 0,
      activeGroups: r4[0]?.active_groups ?? 0,
      totalPrayers: r5[0]?.total_prayers ?? 0,
      activeVolunteers: r6[0]?.active_volunteers ?? 0,
      pendingPrayers: r7[0]?.pending_prayers ?? 0,
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
    return this.cache.wrap(`dashboard:engagement:${tenantId}`, 60, () => this._getEngagement(tenantId));
  }

  private async _getEngagement(tenantId: string) {
    // Fetch total members once (not 6x per week)
    const [[{ total_members: cachedTotal }]] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total_members FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);

    const rows: Array<{ week_start: string; active_members: string }> =
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
             AND created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT author_id, created_at FROM public.comments WHERE tenant_id = $1
             AND created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT user_id, created_at FROM public.post_likes WHERE tenant_id = $1
             AND created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT user_id, checked_in_at FROM public.check_ins WHERE tenant_id = $1
             AND checked_in_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT user_id, created_at FROM public.transactions WHERE tenant_id = $1 AND status = 'succeeded'
             AND created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT gm.user_id, gm.joined_at FROM public.group_members gm
             INNER JOIN public.groups g ON g.id = gm.group_id
             WHERE g.tenant_id = $1 AND gm.joined_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT author_id, created_at FROM public.prayers WHERE tenant_id = $1
             AND created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT er.user_id, er.created_at FROM public.event_rsvps er
             INNER JOIN public.events e ON e.id = er.event_id
             WHERE e.tenant_id = $1 AND er.created_at >= date_trunc('week', now()) - interval '5 weeks'
           UNION ALL
           SELECT gm2.author_id, gm2.created_at FROM public.group_messages gm2
             INNER JOIN public.groups g2 ON g2.id = gm2.group_id
             WHERE g2.tenant_id = $1 AND gm2.created_at >= date_trunc('week', now()) - interval '5 weeks'
         )
         SELECT w.week_start,
           COUNT(DISTINCT a.user_id)::int AS active_members
         FROM weeks w
         LEFT JOIN activity a
           ON a.created_at >= w.week_start
           AND a.created_at < w.week_start + interval '1 week'
         GROUP BY w.week_start
         ORDER BY w.week_start ASC`,
        [tenantId],
      );

    const totalMembers = Number(cachedTotal);
    const weeklyHistory = rows.map(r => {
      const active = Number(r.active_members);
      return {
        weekStart: r.week_start,
        activeMembers: active,
        totalMembers: totalMembers,
        engagementPercent: totalMembers > 0 ? Math.round((active / totalMembers) * 1000) / 10 : 0,
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
