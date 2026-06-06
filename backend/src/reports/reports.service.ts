import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../common/services/cache.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getGivingYoY(tenantId: string) {
    return this.cache.wrap(`reports:yoy:${tenantId}`, 60, () => this._getGivingYoY(tenantId));
  }

  private async _getGivingYoY(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT date_trunc('month', created_at)::date AS month,
         SUM(CASE WHEN EXTRACT(year FROM created_at) = EXTRACT(year FROM now()) THEN amount ELSE 0 END)::float AS current_year,
         SUM(CASE WHEN EXTRACT(year FROM created_at) = EXTRACT(year FROM now()) - 1 THEN amount ELSE 0 END)::float AS last_year
       FROM public.transactions
       WHERE tenant_id = $1 AND status = 'succeeded'
         AND created_at >= date_trunc('year', now() - interval '1 year')
       GROUP BY date_trunc('month', created_at)
       ORDER BY 1`,
      [tenantId],
    );

    return {
      data: rows.map((r: any) => ({
        month: r.month,
        currentYear: r.current_year,
        lastYear: r.last_year,
      })),
    };
  }

  async getFunnel(tenantId: string) {
    return this.cache.wrap(`reports:funnel:${tenantId}`, 60, () => this._getFunnel(tenantId));
  }

  private async _getFunnel(tenantId: string) {
    // Single query instead of 4 sequential queries
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.check_ins
          WHERE tenant_id = $1 AND is_visitor = true AND checked_in_at >= date_trunc('year', now())) AS visitors,
         (SELECT COUNT(*)::int FROM (
            SELECT user_id FROM public.check_ins
            WHERE tenant_id = $1 AND checked_in_at >= now() - interval '90 days'
            GROUP BY user_id HAVING COUNT(*) >= 3
          ) sub) AS regular,
         (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1) AS members,
         (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1 AND role IN ('admin', 'pastor')) AS leaders`,
      [tenantId],
    );

    return {
      visitors: row?.visitors ?? 0,
      regular: row?.regular ?? 0,
      members: row?.members ?? 0,
      leaders: row?.leaders ?? 0,
    };
  }

  async getEngagement(tenantId: string) {
    return this.cache.wrap(`reports:engagement:${tenantId}`, 60, () => this._getEngagement(tenantId));
  }

  private async _getEngagement(tenantId: string) {
    // Pre-aggregate activity counts per user via JOINs instead of N+1 correlated subqueries.
    // Old query ran 3 subqueries PER MEMBER (1000 members = 3000 queries).
    // New query uses LEFT JOINs with pre-aggregated CTEs — always 4 queries total.
    const bucketSql = (windowStart: string, windowEnd: string) => `
      WITH member_ids AS (
        SELECT user_id FROM public.tenant_memberships WHERE tenant_id = $1
      ),
      post_counts AS (
        SELECT author_id AS user_id, COUNT(*)::int AS cnt
        FROM public.posts
        WHERE tenant_id = $1 AND created_at >= ${windowStart} AND created_at < ${windowEnd}
        GROUP BY author_id
      ),
      comment_counts AS (
        SELECT author_id AS user_id, COUNT(*)::int AS cnt
        FROM public.comments
        WHERE tenant_id = $1 AND created_at >= ${windowStart} AND created_at < ${windowEnd}
        GROUP BY author_id
      ),
      checkin_counts AS (
        SELECT user_id, COUNT(*)::int AS cnt
        FROM public.check_ins
        WHERE tenant_id = $1 AND checked_in_at >= ${windowStart} AND checked_in_at < ${windowEnd}
        GROUP BY user_id
      ),
      scores AS (
        SELECT m.user_id,
          COALESCE(p.cnt, 0) + COALESCE(c.cnt, 0) + COALESCE(ci.cnt, 0) AS score
        FROM member_ids m
        LEFT JOIN post_counts p ON p.user_id = m.user_id
        LEFT JOIN comment_counts c ON c.user_id = m.user_id
        LEFT JOIN checkin_counts ci ON ci.user_id = m.user_id
      )
      SELECT
        COUNT(CASE WHEN score = 0 THEN 1 END)::int AS inactive,
        COUNT(CASE WHEN score BETWEEN 1 AND 2 THEN 1 END)::int AS low,
        COUNT(CASE WHEN score BETWEEN 3 AND 5 THEN 1 END)::int AS medium,
        COUNT(CASE WHEN score >= 6 THEN 1 END)::int AS high
      FROM scores`;

    const [currentRows, prevRows, trendRows] = await Promise.all([
      this.dataSource.query(bucketSql(`now() - interval '30 days'`, `now()`), [tenantId]),
      // prev = the 30-day window from 60 days ago to 30 days ago — lets
      // mobile show "vs last month" deltas on each engagement tier.
      this.dataSource.query(bucketSql(`now() - interval '60 days'`, `now() - interval '30 days'`), [tenantId]),
      // 6-week unique-active-member trend — distinct user who posted,
      // commented, or checked-in that week. Always 6 padded rows.
      this.dataSource.query(
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
           SELECT user_id, checked_in_at FROM public.check_ins WHERE tenant_id = $1
             AND checked_in_at >= date_trunc('week', now()) - interval '5 weeks'
         )
         SELECT w.week_start,
           COUNT(DISTINCT a.user_id)::int AS active
         FROM weeks w
         LEFT JOIN activity a
           ON a.created_at >= w.week_start
           AND a.created_at < w.week_start + interval '1 week'
         GROUP BY w.week_start ORDER BY w.week_start ASC`,
        [tenantId],
      ),
    ]);

    const current = currentRows[0] ?? { inactive: 0, low: 0, medium: 0, high: 0 };
    const prev = prevRows[0] ?? { inactive: 0, low: 0, medium: 0, high: 0 };

    return {
      inactive: current.inactive ?? 0,
      low: current.low ?? 0,
      medium: current.medium ?? 0,
      high: current.high ?? 0,
      prev: {
        high: prev.high ?? 0,
        medium: prev.medium ?? 0,
        low: prev.low ?? 0,
      },
      // Mobile sparkline expects bare number[] of active-member counts
      // over the last 6 weeks; labels are inferred client-side.
      trend: (trendRows ?? []).map((r: any) => Number(r.active) || 0),
    };
  }

  async getGivingByFund(tenantId: string) {
    return this.cache.wrap(`reports:givingbyfund:${tenantId}`, 60, () => this._getGivingByFund(tenantId));
  }

  private async _getGivingByFund(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT COALESCE(gf.name, 'General') AS fund_name, SUM(t.amount)::float AS total
       FROM public.transactions t
       LEFT JOIN public.giving_funds gf ON gf.id = t.fund_id
       WHERE t.tenant_id = $1 AND t.status = 'succeeded'
       GROUP BY COALESCE(gf.name, 'General')
       ORDER BY total DESC`,
      [tenantId],
    );

    return {
      data: rows.map((r: any) => ({
        fundName: r.fund_name,
        total: r.total,
      })),
    };
  }

  async getReportKpis(tenantId: string) {
    return this.cache.wrap(`reports:kpis:${tenantId}`, 30, () => this._getReportKpis(tenantId));
  }

  private async _getReportKpis(tenantId: string) {
    const [[row], attendanceTrend, growthTrend] = await Promise.all([
      this.dataSource.query(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'succeeded' AND created_at >= date_trunc('year', now()) THEN amount END), 0)::float AS ytd_giving,
           COALESCE(SUM(CASE WHEN status = 'succeeded' AND created_at >= date_trunc('year', now()) - interval '1 year' AND created_at < date_trunc('year', now()) THEN amount END), 0)::float AS ytd_giving_prev,
           (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1) AS total_members,
           (SELECT COUNT(DISTINCT user_id)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '30 days') AS avg_monthly_attendance,
           (SELECT COUNT(DISTINCT user_id)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '60 days' AND checked_in_at < now() - interval '30 days') AS avg_monthly_attendance_prev,
           (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())) AS new_members_this_month,
           (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1 AND created_at >= date_trunc('month', now()) - interval '1 month' AND created_at < date_trunc('month', now())) AS new_members_prev
         FROM public.transactions WHERE tenant_id = $1`,
        [tenantId],
      ),
      // 6-week attendance trend — bucketed by week_start. Always 6 rows
      // (zeros padded) so the mobile bar chart has a stable shape.
      this.dataSource.query(
        `WITH weeks AS (
           SELECT generate_series(
             date_trunc('week', now()) - interval '5 weeks',
             date_trunc('week', now()),
             '1 week'::interval
           )::date AS week_start
         )
         SELECT w.week_start,
           COALESCE((SELECT COUNT(*)::int FROM public.check_ins ci
                     WHERE ci.tenant_id = $1
                       AND ci.checked_in_at >= w.week_start
                       AND ci.checked_in_at <  w.week_start + interval '1 week'), 0) AS count
         FROM weeks w ORDER BY w.week_start ASC`,
        [tenantId],
      ),
      // 6-week new-membership trend — same shape so the mobile can pair
      // them on a single chart.
      this.dataSource.query(
        `WITH weeks AS (
           SELECT generate_series(
             date_trunc('week', now()) - interval '5 weeks',
             date_trunc('week', now()),
             '1 week'::interval
           )::date AS week_start
         )
         SELECT w.week_start,
           COALESCE((SELECT COUNT(*)::int FROM public.tenant_memberships tm
                     WHERE tm.tenant_id = $1
                       AND tm.created_at >= w.week_start
                       AND tm.created_at <  w.week_start + interval '1 week'), 0) AS count
         FROM weeks w ORDER BY w.week_start ASC`,
        [tenantId],
      ),
    ]);

    return {
      ytdGiving: row?.ytd_giving ?? 0,
      ytdGivingPrev: row?.ytd_giving_prev ?? 0,
      totalMembers: row?.total_members ?? 0,
      avgMonthlyAttendance: row?.avg_monthly_attendance ?? 0,
      avgMonthlyAttendancePrev: row?.avg_monthly_attendance_prev ?? 0,
      newMembersThisMonth: row?.new_members_this_month ?? 0,
      newMembersPrev: row?.new_members_prev ?? 0,
      // Mobile expects bare number[] for sparkline rendering (per the
      // contract documented in the mock-data round-up). The week-start
      // labels are derivable client-side from "the last 6 weeks ending
      // today" so we don't ship them.
      attendanceTrend: (attendanceTrend ?? []).map((r: any) => Number(r.count) || 0),
      growthTrend: (growthTrend ?? []).map((r: any) => Number(r.count) || 0),
    };
  }

  async exportData(tenantId: string, type: string, startDate?: string, endDate?: string) {
    // Default date range: last 1 year. Cap at 50,000 rows to prevent OOM.
    const start = startDate ? new Date(startDate).toISOString() : new Date(Date.now() - 365 * 86400000).toISOString();
    const end = endDate ? new Date(endDate).toISOString() : new Date().toISOString();
    const ROW_LIMIT = 50000;

    switch (type) {
      case 'members': {
        const rows = await this.dataSource.query(
          `SELECT u.id, u.email, u.full_name, tm.role, tm.created_at AS joined_at
           FROM public.tenant_memberships tm
           JOIN public.users u ON u.id = tm.user_id
           WHERE tm.tenant_id = $1
           ORDER BY tm.created_at DESC
           LIMIT $2`,
          [tenantId, ROW_LIMIT],
        );
        return {
          data: rows.map((r: any) => ({
            id: r.id,
            email: r.email,
            fullName: r.full_name,
            role: r.role,
            joinedAt: r.joined_at,
          })),
        };
      }

      case 'giving': {
        const rows = await this.dataSource.query(
          `SELECT t.id, t.amount, t.currency, t.status, t.created_at,
                  u.email AS donor_email, u.full_name AS donor_name,
                  COALESCE(gf.name, 'General') AS fund_name
           FROM public.transactions t
           JOIN public.users u ON u.id = t.user_id
           LEFT JOIN public.giving_funds gf ON gf.id = t.fund_id
           WHERE t.tenant_id = $1 AND t.created_at >= $2 AND t.created_at <= $3
           ORDER BY t.created_at DESC
           LIMIT $4`,
          [tenantId, start, end, ROW_LIMIT],
        );
        return {
          data: rows.map((r: any) => ({
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            status: r.status,
            donorEmail: r.donor_email,
            donorName: r.donor_name,
            fundName: r.fund_name,
            createdAt: r.created_at,
          })),
        };
      }

      case 'attendance': {
        const rows = await this.dataSource.query(
          `SELECT ci.id, ci.checked_in_at, ci.is_visitor,
                  u.email, u.full_name,
                  ss.name AS service_name
           FROM public.check_ins ci
           JOIN public.users u ON u.id = ci.user_id
           LEFT JOIN public.service_schedules ss ON ss.id = ci.service_id
           WHERE ci.tenant_id = $1 AND ci.checked_in_at >= $2 AND ci.checked_in_at <= $3
           ORDER BY ci.checked_in_at DESC
           LIMIT $4`,
          [tenantId, start, end, ROW_LIMIT],
        );
        return {
          data: rows.map((r: any) => ({
            id: r.id,
            checkedInAt: r.checked_in_at,
            isVisitor: r.is_visitor,
            email: r.email,
            fullName: r.full_name,
            serviceName: r.service_name,
          })),
        };
      }

      default:
        throw new BadRequestException(`Invalid export type: ${type}. Must be members, giving, or attendance.`);
    }
  }
}
