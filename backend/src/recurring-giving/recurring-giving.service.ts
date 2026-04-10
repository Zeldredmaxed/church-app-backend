import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { RecurringGift } from './entities/recurring-gift.entity';
import { CreateRecurringGiftDto } from './dto/create-recurring-gift.dto';

@Injectable()
export class RecurringGivingService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getRecurringGifts(userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT * FROM public.recurring_gifts WHERE user_id = $1 AND status != 'cancelled' ORDER BY created_at DESC`,
      [userId],
    );

    return {
      gifts: rows.map((r: any) => this.mapGift(r)),
    };
  }

  /**
   * Admin view: all recurring gifts for the tenant with donor names.
   */
  async getAllRecurringGifts(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT rg.*, u.full_name AS donor_name, u.email AS donor_email
       FROM public.recurring_gifts rg
       JOIN public.users u ON u.id = rg.user_id
       WHERE rg.tenant_id = $1
       ORDER BY rg.status ASC, rg.amount DESC`,
      [tenantId],
    );

    const gifts = rows.map((r: any) => ({
      ...this.mapGift(r),
      donorName: r.donor_name,
      donorEmail: r.donor_email,
    }));

    const active = gifts.filter((g: any) => g.status === 'active');
    const totalPledged = active.reduce((sum: number, g: any) => sum + g.amount, 0);

    return {
      gifts,
      stats: {
        totalPlans: gifts.length,
        activePlans: active.length,
        pausedPlans: gifts.filter((g: any) => g.status === 'paused').length,
        cancelledPlans: gifts.filter((g: any) => g.status === 'cancelled').length,
        totalPledged,
      },
    };
  }

  async createRecurringGift(dto: CreateRecurringGiftDto, userId: string, tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    // TODO: Create Stripe subscription and store stripe_subscription_id
    const gift = queryRunner.manager.create(RecurringGift, {
      tenantId,
      userId,
      amount: dto.amount,
      currency: dto.currency ?? 'usd',
      frequency: dto.frequency,
      fundName: dto.fundName ?? null,
      status: 'active',
    });
    return queryRunner.manager.save(RecurringGift, gift);
  }

  async pauseGift(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.query(
      `UPDATE public.recurring_gifts SET status = 'paused' WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (Array.isArray(result) && result[1] === 0) throw new NotFoundException('Recurring gift not found');
    return { message: 'Gift paused' };
  }

  async resumeGift(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.query(
      `UPDATE public.recurring_gifts SET status = 'active' WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (Array.isArray(result) && result[1] === 0) throw new NotFoundException('Recurring gift not found');
    return { message: 'Gift resumed' };
  }

  async cancelGift(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const result = await queryRunner.query(
      `UPDATE public.recurring_gifts SET status = 'cancelled' WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (Array.isArray(result) && result[1] === 0) throw new NotFoundException('Recurring gift not found');
    return { message: 'Gift cancelled' };
  }

  private mapGift(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      amount: Number(r.amount),
      currency: r.currency,
      frequency: r.frequency,
      fundName: r.fund_name,
      stripeSubscriptionId: r.stripe_subscription_id,
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
