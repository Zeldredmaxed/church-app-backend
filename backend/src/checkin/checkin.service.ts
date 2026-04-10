import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { CheckIn } from './entities/check-in.entity';
import { AddVisitorDto } from './dto/add-visitor.dto';

@Injectable()
export class CheckinService {
  constructor(private readonly dataSource: DataSource) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getCurrentServices() {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT * FROM public.services WHERE day_of_week = EXTRACT(DOW FROM now())::int ORDER BY start_time ASC`,
    );

    return {
      services: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        createdAt: r.created_at,
      })),
    };
  }

  async checkIn(userId: string, serviceId?: string) {
    if (!serviceId) {
      throw new BadRequestException('serviceId is required');
    }
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const checkIn = queryRunner.manager.create(CheckIn, {
      tenantId: currentTenantId!,
      userId,
      serviceId,
    });
    const saved = await queryRunner.manager.save(CheckIn, checkIn);
    return { message: 'Checked in successfully', checkedInAt: saved.checkedInAt };
  }

  /**
   * Returns all services for a tenant (not just today's).
   * Uses service-role DataSource.
   */
  async getAllServices(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM public.services WHERE tenant_id = $1 ORDER BY day_of_week, start_time`,
      [tenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      createdAt: r.created_at,
    }));
  }

  /**
   * Returns a roster of members with their check-in status for a given date.
   * Uses service-role DataSource.
   */
  async getRoster(tenantId: string, serviceId?: string, date?: string) {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    const rows = await this.dataSource.query(
      `SELECT u.id, u.full_name, u.avatar_url, u.email,
        EXISTS(
          SELECT 1 FROM public.check_ins c
          WHERE c.user_id = u.id AND c.tenant_id = $1
            AND c.checked_in_at::date = $2::date
            AND ($3::uuid IS NULL OR c.service_id = $3::uuid)
        ) AS checked_in
       FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1
       ORDER BY u.full_name`,
      [tenantId, targetDate, serviceId ?? null],
    );

    return rows.map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      email: r.email,
      checkedIn: r.checked_in,
    }));
  }

  /**
   * Bulk check-in multiple users for a service.
   * Avoids duplicates by checking existing check-ins for today.
   * Uses service-role DataSource.
   */
  async bulkCheckIn(tenantId: string, userIds: string[], serviceId?: string) {
    if (userIds.length === 0) return { checkedIn: 0 };

    const result = await this.dataSource.query(
      `INSERT INTO public.check_ins (tenant_id, user_id, service_id)
       SELECT $1, uid, $3::uuid
       FROM unnest($2::uuid[]) AS uid
       WHERE NOT EXISTS (
         SELECT 1 FROM public.check_ins c
         WHERE c.tenant_id = $1
           AND c.user_id = uid
           AND c.checked_in_at::date = CURRENT_DATE
           AND (($3::uuid IS NULL AND c.service_id IS NULL) OR c.service_id = $3::uuid)
       )
       RETURNING id`,
      [tenantId, userIds, serviceId ?? null],
    );

    return { checkedIn: result.length };
  }

  /**
   * Returns attendance KPI metrics for the dashboard.
   * Uses service-role DataSource.
   */
  async getAttendanceKpis(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at::date = CURRENT_DATE) AS today_count,
        (SELECT COUNT(*)::int FROM public.check_ins WHERE tenant_id = $1 AND is_visitor = true AND checked_in_at >= date_trunc('week', now())) AS visitors_this_week,
        (SELECT COUNT(DISTINCT user_id)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '7 days') AS unique_last_7d`,
      [tenantId],
    );

    const row = rows[0] ?? {};
    return {
      todayCount: row.today_count ?? 0,
      visitorsThisWeek: row.visitors_this_week ?? 0,
      uniqueLast7d: row.unique_last_7d ?? 0,
    };
  }

  /**
   * Records a visitor check-in (no user account required).
   * Uses service-role DataSource.
   */
  async addVisitor(tenantId: string, dto: AddVisitorDto) {
    const rows = await this.dataSource.query(
      `INSERT INTO public.check_ins (tenant_id, user_id, service_id, is_visitor, visitor_name)
       VALUES ($1, NULL, $2::uuid, true, $3)
       RETURNING id, checked_in_at`,
      [tenantId, dto.serviceId ?? null, dto.name],
    );

    return {
      message: 'Visitor recorded',
      id: rows[0].id,
      checkedInAt: rows[0].checked_in_at,
    };
  }

  // ─── CHILD CHECK-IN SAFETY ───

  /**
   * Check in a child with guardian linking and security code generation.
   * Generates a 4-digit security code for pickup verification.
   */
  async checkInChild(tenantId: string, dto: {
    childId?: string;
    childName?: string;
    guardianId: string;
    serviceId?: string;
  }) {
    // Generate a random 4-digit security code
    const securityCode = String(Math.floor(1000 + Math.random() * 9000));

    const [row] = await this.dataSource.query(
      `INSERT INTO public.check_ins
        (tenant_id, user_id, service_id, guardian_id, security_code, child_name, check_in_type)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual')
       RETURNING id, checked_in_at, security_code`,
      [
        tenantId,
        dto.childId ?? null,
        dto.serviceId ?? null,
        dto.guardianId,
        securityCode,
        dto.childName ?? null,
      ],
    );

    // Get medical alerts for the child (if they have a user account)
    let medicalAlerts: any[] = [];
    if (dto.childId) {
      medicalAlerts = await this.dataSource.query(
        `SELECT id, alert_type, description, severity
         FROM public.member_medical_alerts
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY severity DESC`,
        [tenantId, dto.childId],
      );
    }

    return {
      checkInId: row.id,
      securityCode: row.security_code,
      checkedInAt: row.checked_in_at,
      childName: dto.childName,
      childId: dto.childId,
      guardianId: dto.guardianId,
      medicalAlerts: medicalAlerts.map((a: any) => ({
        id: a.id,
        type: a.alert_type,
        description: a.description,
        severity: a.severity,
      })),
      labelData: {
        childName: dto.childName,
        securityCode: row.security_code,
        serviceName: null, // frontend can resolve from serviceId
        checkedInAt: row.checked_in_at,
        hasAlerts: medicalAlerts.length > 0,
        alertCount: medicalAlerts.length,
      },
    };
  }

  /**
   * Verify a pickup security code.
   */
  async verifyPickupCode(tenantId: string, securityCode: string) {
    const rows = await this.dataSource.query(
      `SELECT ci.id, ci.user_id, ci.guardian_id, ci.child_name, ci.checked_in_at,
              g.full_name AS guardian_name,
              c.full_name AS child_full_name
       FROM public.check_ins ci
       LEFT JOIN public.users g ON g.id = ci.guardian_id
       LEFT JOIN public.users c ON c.id = ci.user_id
       WHERE ci.tenant_id = $1 AND ci.security_code = $2
         AND ci.checked_in_at >= CURRENT_DATE
       ORDER BY ci.checked_in_at DESC LIMIT 1`,
      [tenantId, securityCode],
    );

    if (rows.length === 0) {
      return { valid: false, message: 'Invalid security code or no check-in found for today' };
    }

    const r = rows[0];

    // Get authorized pickups
    const pickups = r.user_id ? await this.dataSource.query(
      `SELECT pickup_name, relationship FROM public.authorized_pickups
       WHERE tenant_id = $1 AND child_id = $2`,
      [tenantId, r.user_id],
    ) : [];

    return {
      valid: true,
      childName: r.child_name || r.child_full_name,
      guardianName: r.guardian_name,
      checkedInAt: r.checked_in_at,
      authorizedPickups: [
        { name: r.guardian_name, relationship: 'Guardian (checked in)' },
        ...pickups.map((p: any) => ({ name: p.pickup_name, relationship: p.relationship })),
      ],
    };
  }

  /**
   * Get medical alerts for a member.
   */
  async getMedicalAlerts(tenantId: string, userId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, alert_type, description, severity, created_at
       FROM public.member_medical_alerts
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY severity DESC, created_at DESC`,
      [tenantId, userId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      type: r.alert_type,
      description: r.description,
      severity: r.severity,
      createdAt: r.created_at,
    }));
  }

  /**
   * Add a medical alert for a member.
   */
  async addMedicalAlert(tenantId: string, userId: string, dto: {
    alertType: string;
    description: string;
    severity?: string;
  }, createdBy: string) {
    const [row] = await this.dataSource.query(
      `INSERT INTO public.member_medical_alerts (tenant_id, user_id, alert_type, description, severity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, userId, dto.alertType, dto.description, dto.severity ?? 'medium', createdBy],
    );

    return {
      id: row.id,
      type: row.alert_type,
      description: row.description,
      severity: row.severity,
      createdAt: row.created_at,
    };
  }

  /**
   * Delete a medical alert.
   */
  async deleteMedicalAlert(tenantId: string, alertId: string) {
    const rows = await this.dataSource.query(
      `DELETE FROM public.member_medical_alerts WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [alertId, tenantId],
    );
    if (rows.length === 0) throw new BadRequestException('Alert not found');
  }
}
