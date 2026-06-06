import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  InternalServerErrorException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { IsIn, IsString, IsUrl } from 'class-validator';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  TIER_DISPLAY_NAMES,
  TIER_MONTHLY_PRICE_CENTS,
  getTierLevel,
  TierName,
} from '../common/config/tier-features.config';

/**
 * Body for POST /api/stripe/checkout/plan-upgrade.
 *
 * `targetTier` is intentionally restricted to the upgrade-able tiers —
 * 'standard' is the entry tier and there's no checkout path TO it. Any
 * downgrade or same-tier request is rejected server-side by the
 * getTierLevel() comparison in the controller.
 */
export class PlanUpgradeDto {
  @IsString()
  @IsIn(['premium', 'enterprise'])
  targetTier!: 'premium' | 'enterprise';

  /**
   * Where Stripe should send the admin after the checkout completes.
   * Both the success and cancel URLs are derived from this base URL.
   */
  @IsUrl({ require_tld: false, require_protocol: true })
  returnUrl!: string;
}

/**
 * Plan-upgrade checkout endpoint.
 *
 * One endpoint, three upgrade transitions:
 *   standard → premium / standard → enterprise / premium → enterprise.
 *
 * Returns a Stripe-hosted Checkout URL; the actual tier flip happens in
 * stripe-webhook.controller.ts on the `checkout.session.completed` event
 * (single source of truth — we never trust the redirect).
 */
@ApiTags('Stripe Checkout')
@ApiBearerAuth()
@Controller('stripe/checkout')
@UseGuards(JwtAuthGuard, RoleGuard)
@UseInterceptors(RlsContextInterceptor)
export class StripeCheckoutController {
  private readonly logger = new Logger(StripeCheckoutController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Post('plan-upgrade')
  @RequiresRole('admin', 'pastor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Stripe Checkout session to upgrade the church plan',
    description:
      'Admin/pastor only. Refuses downgrades and already-on-tier upgrades. ' +
      'Returns a hosted Checkout URL — the tier flip happens on the ' +
      'checkout.session.completed webhook, not the redirect.',
  })
  @ApiResponse({ status: 200, description: '{ checkoutUrl: string }' })
  @ApiResponse({ status: 400, description: 'Invalid target tier / downgrade / no tenant context' })
  async createPlanUpgradeCheckout(
    @Body() dto: PlanUpgradeDto,
  ): Promise<{ checkoutUrl: string }> {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    const { queryRunner, userId, currentTenantId } = ctx;
    if (!currentTenantId) throw new BadRequestException('No active tenant context');

    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant not found');

    // Refuse downgrades and same-tier requests. The product decision is
    // "upgrade-only" for now — downgrades are out of scope.
    const currentLevel = getTierLevel(tenant.tier);
    const targetLevel = getTierLevel(dto.targetTier);
    if (targetLevel === currentLevel) {
      throw new BadRequestException(`Already on ${TIER_DISPLAY_NAMES[tenant.tier as TierName]}`);
    }
    if (targetLevel < currentLevel) {
      throw new BadRequestException('Downgrades not supported');
    }

    // Lazy-create the Stripe billing Customer for this tenant. SELECT ...
    // FOR UPDATE around the null-check + UPDATE prevents two concurrent
    // upgrades from each calling stripe.customers.create and leaving an
    // orphan in Stripe — same pattern as recurring-giving.service.
    const billingCustomerId: string = await this.dataSource.transaction(async (tx) => {
      const [row] = await tx.query(
        `SELECT name, stripe_billing_customer_id
         FROM public.tenants WHERE id = $1 FOR UPDATE`,
        [currentTenantId],
      );
      if (!row) throw new BadRequestException('Tenant not found');
      if (row.stripe_billing_customer_id) return row.stripe_billing_customer_id;

      // Use the acting admin's email so Stripe has a fallback contact
      // for refund / dunning / receipt email if Checkout capture fails.
      // Without this, Stripe ends up with no email on the Customer
      // until first successful Checkout, which means silent sub-cancel
      // notices on card-expiry never reach anyone.
      const [actor] = await tx.query(
        `SELECT email FROM public.users WHERE id = $1`,
        [userId],
      );
      const customer = await this.stripeService.createCustomer(
        actor?.email ?? '',
        row.name,
      );
      await tx.query(
        `UPDATE public.tenants SET stripe_billing_customer_id = $1 WHERE id = $2`,
        [customer.id, currentTenantId],
      );
      this.logger.log(
        `Created billing Stripe Customer ${customer.id} for tenant ${currentTenantId}`,
      );
      return customer.id;
    });

    // Stripe idempotency keys are valid for 24h — a 10-min bucket lets
    // a distracted admin click Upgrade, get pulled away, come back
    // 5-9 min later, retry, and still hit the SAME Checkout Session URL.
    // A minute bucket was too narrow (a 90s pause created a second paid
    // sub in testing). 10 min is the sweet spot between "rides out a
    // distracted admin" and "two distinct upgrade intents in the same
    // hour collapse correctly."
    const tenMinuteBucket = Math.floor(Date.now() / 600_000);
    const idempotencyKey = ['plan-upgrade', currentTenantId, dto.targetTier, tenMinuteBucket].join(':');

    const amountCents = TIER_MONTHLY_PRICE_CENTS[dto.targetTier];
    const tierLabel = TIER_DISPLAY_NAMES[dto.targetTier];

    const session = await this.stripeService.createCheckoutSession({
      customerId: billingCustomerId,
      amountCents,
      tierLabel,
      returnUrl: dto.returnUrl,
      tenantId: currentTenantId,
      targetTier: dto.targetTier,
      actorUserId: userId,
      idempotencyKey,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }

    // Audit the initiation. The completion event fires later in the
    // webhook with a different action name so the admin browse can show
    // both "started" and "completed" rows.
    const [actor] = await queryRunner.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [userId],
    );
    await this.audit.log({
      action: 'tenant.plan_upgrade_initiated',
      resourceType: 'church',
      resourceId: currentTenantId,
      summary: `${actor?.full_name ?? 'Admin'} started upgrade to ${tierLabel} for "${tenant.name}"`,
      metadata: {
        from: tenant.tier,
        to: dto.targetTier,
        amountCents,
        sessionId: session.id,
      },
    });

    return { checkoutUrl: session.url };
  }
}
