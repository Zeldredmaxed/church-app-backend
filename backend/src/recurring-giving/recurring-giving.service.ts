import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { RecurringGift } from './entities/recurring-gift.entity';
import { CreateRecurringGiftDto } from './dto/create-recurring-gift.dto';
import { StripeService } from '../stripe/stripe.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { getTierFeatures } from '../common/config/tier-features.config';

@Injectable()
export class RecurringGivingService {
  private readonly logger = new Logger(RecurringGivingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripe: StripeService,
  ) {}

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
    return { gifts: rows.map((r: any) => this.mapGift(r)) };
  }

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

  /**
   * Real Stripe subscription creation. Steps:
   *   1. Look up the tenant's Connect account; refuse if not active
   *   2. Look up or create a Stripe Customer for the donor
   *   3. Attach the donor's payment method to that customer if not already
   *   4. Create the Subscription with inline price_data (no Price object
   *      to maintain per amount × frequency × fund combination)
   *   5. Persist the subscription_id on the recurring_gifts row
   *
   * Webhook coverage (handled separately in the Stripe webhook
   * controller): on `invoice.paid` we should bump `last_charged_at`; on
   * `invoice.payment_failed` we should mark the gift `past_due` and
   * notify the donor.
   */
  async createRecurringGift(dto: CreateRecurringGiftDto, userId: string, tenantId: string) {
    // 1. Tenant Connect status.
    const tenant = await this.dataSource.manager.findOne(Tenant, { where: { id: tenantId } });
    if (!tenant?.stripeAccountId || tenant.stripeAccountStatus !== 'active') {
      throw new BadRequestException('This church has not finished payment setup.');
    }

    // 2. Pre-check for an identical active gift so a double-tap or
    // stale retry can't create a duplicate sub. `IS NOT DISTINCT FROM`
    // makes null fund names match null fund names.
    const [existing] = await this.dataSource.query(
      `SELECT id FROM public.recurring_gifts
       WHERE user_id = $1 AND tenant_id = $2 AND amount = $3 AND currency = $4
         AND frequency = $5 AND fund_name IS NOT DISTINCT FROM $6
         AND status = 'active'
       LIMIT 1`,
      [userId, tenantId, dto.amount, dto.currency ?? 'usd', dto.frequency, dto.fundName ?? null],
    );
    if (existing) {
      this.logger.log(
        `Duplicate recurring-gift attempt by ${userId} for tenant ${tenantId} — returning existing ${existing.id}`,
      );
      return this.dataSource.manager.findOne(RecurringGift, { where: { id: existing.id } });
    }

    // 3. Look up or lazily create Stripe Customer. SELECT ... FOR
    // UPDATE wrapping the null-check + UPDATE prevents two concurrent
    // requests from each calling createCustomer + UPDATE, which would
    // leave an orphan Customer floating in Stripe forever.
    const stripeCustomerId: string = await this.dataSource.transaction(async (tx) => {
      const [row] = await tx.query(
        `SELECT email, full_name, stripe_customer_id
         FROM public.users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!row) throw new BadRequestException('User not found');
      if (row.stripe_customer_id) return row.stripe_customer_id;

      const customer = await this.stripe.createCustomer(row.email, row.full_name ?? undefined);
      await tx.query(
        `UPDATE public.users SET stripe_customer_id = $1 WHERE id = $2`,
        [customer.id, userId],
      );
      return customer.id;
    });

    // 4. Verify the payment method. A freshly-confirmed SetupIntent PM
    // may still have customer === null — attach it before Subscription
    // create, else Stripe returns 400 "payment_method not attached."
    const pm = await this.stripe.retrievePaymentMethod(dto.paymentMethodId);
    if (pm.customer && pm.customer !== stripeCustomerId) {
      throw new BadRequestException('paymentMethodId belongs to a different customer');
    }
    if (!pm.customer) {
      await this.stripe.attachPaymentMethod(dto.paymentMethodId, stripeCustomerId);
    }

    // 5. Stripe idempotency key — derived from a stable shape. A
    // network-retry within the same minute returns the same sub, no
    // double-charge. Two distinct intents would either land in
    // different minutes or differ on a field, so they hash differently.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = [
      'rg', userId, dto.amount, dto.currency ?? 'usd', dto.frequency,
      dto.fundName ?? '', minuteBucket,
    ].join(':');

    const tierFeatures = getTierFeatures(tenant.tier);
    const subscription = await this.stripe.createSubscription({
      customerId: stripeCustomerId,
      paymentMethodId: dto.paymentMethodId,
      amountCents: Math.round(dto.amount * 100),
      currency: (dto.currency ?? 'usd').toLowerCase(),
      frequency: dto.frequency,
      destinationAccountId: tenant.stripeAccountId,
      platformFeePercent: tierFeatures.transactionFeePercent,
      metadata: { tenantId, userId, fundName: dto.fundName ?? '' },
      idempotencyKey,
    });

    // 6. Persist. queryRunner from the RLS context is the right transaction.
    const { queryRunner } = this.getRlsContext();
    const gift = queryRunner.manager.create(RecurringGift, {
      tenantId,
      userId,
      amount: dto.amount,
      currency: dto.currency ?? 'usd',
      frequency: dto.frequency,
      fundName: dto.fundName ?? null,
      stripeSubscriptionId: subscription.id,
      status: 'active',
    });
    const saved = await queryRunner.manager.save(RecurringGift, gift);

    this.logger.log(
      `Recurring gift ${saved.id} created with Stripe subscription ${subscription.id}`,
    );
    return saved;
  }

  async pauseGift(id: string, userId: string) {
    return this.transitionGift(id, userId, 'paused', (subId) => this.stripe.pauseSubscription(subId));
  }

  async resumeGift(id: string, userId: string) {
    return this.transitionGift(id, userId, 'active', (subId) => this.stripe.resumeSubscription(subId));
  }

  async cancelGift(id: string, userId: string) {
    return this.transitionGift(id, userId, 'cancelled', async (subId) => {
      try {
        await this.stripe.cancelSubscription(subId);
      } catch (err: any) {
        // Already cancelled / not found on Stripe — proceed with local
        // cancellation. We don't want the local row stuck.
        this.logger.warn(`Stripe cancel for sub ${subId} failed (ignoring): ${err.message}`);
      }
    });
  }

  /**
   * Shared transition helper for pause/resume/cancel. Holds a row-level
   * lock across (load → Stripe call → local UPDATE) so two concurrent
   * transitions can't interleave and leave the local row out of sync
   * with Stripe's actual state.
   */
  private async transitionGift(
    id: string,
    userId: string,
    newStatus: 'paused' | 'active' | 'cancelled',
    stripeAction: (subId: string) => Promise<any>,
  ) {
    return this.dataSource.transaction(async (tx) => {
      const [row] = await tx.query(
        `SELECT id, stripe_subscription_id
         FROM public.recurring_gifts
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, userId],
      );
      if (!row) throw new NotFoundException('Recurring gift not found');

      if (row.stripe_subscription_id) {
        await stripeAction(row.stripe_subscription_id);
      }
      await tx.query(
        `UPDATE public.recurring_gifts SET status = $1 WHERE id = $2`,
        [newStatus, id],
      );
      return {
        message: `Gift ${newStatus === 'active' ? 'resumed' : newStatus}`,
      };
    });
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
