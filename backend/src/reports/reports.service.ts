import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getGivingYoY(tenantId: string) {
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
    const [visitors] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM public.check_ins
       WHERE tenant_id = $1 AND is_visitor = true
         AND checked_in_at >= date_trunc('year', now())`,
      [tenantId],
    );

    const [regular] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT user_id
         FROM public.check_ins
         WHERE tenant_id = $1
           AND checked_in_at >= now() - interval '90 days'
         GROUP BY user_id
         HAVING COUNT(*) >= 3
       ) sub`,
      [tenantId],
    );

    const [members] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM public.tenant_memberships
       WHERE tenant_id = $1`,
      [tenantId],
    );

    const [leaders] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
       FROM public.tenant_memberships
       WHERE tenant_id = $1 AND role IN ('admin', 'pastor')`,
      [tenantId],
    );

    return {
      visitors: visitors?.count ?? 0,
      regular: regular?.count ?? 0,
      members: members?.count ?? 0,
      leaders: leaders?.count ?? 0,
    };
  }

  async getEngagement(tenantId: string) {
    const [row] = await this.dataSource.query(
      `WITH scores AS (
        SELECT u.id,
          (SELECT COUNT(*)::int FROM public.posts WHERE author_id = u.id AND tenant_id = $1 AND created_at >= now() - interval '30 days') +
          (SELECT COUNT(*)::int FROM public.comments WHERE author_id = u.id AND tenant_id = $1 AND created_at >= now() - interval '30 days') +
          (SELECT COUNT(*)::int FROM public.check_ins WHERE user_id = u.id AND tenant_id = $1 AND checked_in_at >= now() - interval '30 days') AS score
        FROM public.tenant_memberships tm
        JOIN public.users u ON u.id = tm.user_id
        WHERE tm.tenant_id = $1
      )
      SELECT
        COUNT(CASE WHEN score = 0 THEN 1 END)::int AS inactive,
        COUNT(CASE WHEN score BETWEEN 1 AND 2 THEN 1 END)::int AS low,
        COUNT(CASE WHEN score BETWEEN 3 AND 5 THEN 1 END)::int AS medium,
        COUNT(CASE WHEN score >= 6 THEN 1 END)::int AS high
      FROM scores`,
      [tenantId],
    );

    return {
      inactive: row.inactive,
      low: row.low,
      medium: row.medium,
      high: row.high,
    };
  }

  async getGivingByFund(tenantId: string) {
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
    const [row] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'succeeded' AND created_at >= date_trunc('year', now()) THEN amount END), 0)::float AS ytd_giving,
         (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1) AS total_members,
         (SELECT COUNT(DISTINCT user_id)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '30 days') AS avg_monthly_attendance
       FROM public.transactions WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      ytdGiving: row.ytd_giving,
      totalMembers: row.total_members,
      avgMonthlyAttendance: row.avg_monthly_attendance,
    };
  }

  async exportData(tenantId: string, type: string) {
    switch (type) {
      case 'members': {
        const rows = await this.dataSource.query(
          `SELECT u.id, u.email, u.full_name, tm.role, tm.created_at AS joined_at
           FROM public.tenant_memberships tm
           JOIN public.users u ON u.id = tm.user_id
           WHERE tm.tenant_id = $1
           ORDER BY tm.created_at DESC`,
          [tenantId],
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
           WHERE t.tenant_id = $1
           ORDER BY t.created_at DESC`,
          [tenantId],
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
           WHERE ci.tenant_id = $1
           ORDER BY ci.checked_in_at DESC`,
          [tenantId],
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
