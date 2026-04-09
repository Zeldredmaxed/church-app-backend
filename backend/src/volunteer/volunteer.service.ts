import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';

@Injectable()
export class VolunteerService {
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
}
