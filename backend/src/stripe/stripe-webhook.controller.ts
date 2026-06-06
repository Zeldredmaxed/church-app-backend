import {
  Controller,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { StripeService } from './stripe.service';
import { Transaction } from '../giving/entities/transaction.entity';
import { FundraiserDonation } from '../fundraisers/entities/fundraiser-donation.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import Stripe from 'stripe';

@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly dataSource: DataSource,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook receiver (signature-verified, no JWT)' })
  @ApiResponse({ status: 200, description: '{ received: true }' })
  @ApiResponse({ status: 401, description: 'Invalid or missing stripe-signature header' })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    const signature = req.headers['stripe-signature'] as string | undefined;

    if (!signature) {
      this.logger.warn('Stripe webhook received without signature header');
      throw new UnauthorizedException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Raw body not available. Ensure NestFactory.create has rawBody: true.',
      );
      throw new UnauthorizedException('Cannot verify signature: raw body unavailable');
    }

    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log(`Stripe webhook received: ${event.type} (${event.id})`);

    // Filter events from the wrong environment (test events in prod, live events in dev)
    const isProduction = process.env.NODE_ENV === 'production';
    if (event.livemode !== isProduction) {
      this.logger.log(`Skipping ${event.livemode ? 'live' : 'test'} event ${event.id} in ${isProduction ? 'production' : 'development'} environment`);
      return { received: true };
    }

    // Idempotency: skip events already processed (handles Stripe retries)
    const [inserted] = await this.dataSource.query(
      `INSERT INTO public.stripe_processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id],
    );
    if (!inserted) {
      this.logger.log(`Duplicate Stripe event skipped: ${event.id}`);
      return { received: true };
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(`PaymentIntent succeeded: ${pi.id}`);
        // Update giving transactions
        await this.dataSource.manager.update(
          Transaction,
          { stripePaymentIntentId: pi.id },
          { status: 'succeeded' },
        );
        // Update fundraiser donations (trigger auto-updates fundraiser totals)
        await this.dataSource.manager.update(
          FundraiserDonation,
          { paymentIntentId: pi.id },
          { paymentStatus: 'succeeded' },
        );
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(`PaymentIntent failed: ${pi.id}`);
        await this.dataSource.manager.update(
          Transaction,
          { stripePaymentIntentId: pi.id },
          { status: 'failed' },
        );
        await this.dataSource.manager.update(
          FundraiserDonation,
          { paymentIntentId: pi.id },
          { paymentStatus: 'failed' },
        );
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        this.logger.log(`Connect account updated: ${account.id}`);
        const status = account.charges_enabled ? 'active' : 'restricted';
        await this.dataSource.manager.update(
          Tenant,
          { stripeAccountId: account.id },
          { stripeAccountStatus: status },
        );
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId ?? session.client_reference_id ?? null;
        const targetTier = session.metadata?.targetTier as
          | 'standard'
          | 'premium'
          | 'enterprise'
          | undefined;
        const actorUserId = session.metadata?.actorUserId ?? null;

        if (!tenantId || !targetTier) {
          this.logger.warn(
            `checkout.session.completed missing tenantId/targetTier metadata (session ${session.id}) — skipping`,
          );
          break;
        }
        if (targetTier !== 'premium' && targetTier !== 'enterprise') {
          this.logger.warn(
            `checkout.session.completed targetTier=${targetTier} not upgrade-able — skipping`,
          );
          break;
        }

        // No RLS context here — webhook is unauthenticated. Use service-role
        // dataSource directly, with written justification (CLAUDE.md rule).
        //
        // Two structural defenses against metadata-spoofed tier upgrades:
        //   1. Verify session.customer matches the tenant's billing customer
        //      (so a metadata.tenantId pointed at a different tenant whose
        //      checkout was for a different Stripe Customer is rejected).
        //   2. Wrap the load → check → UPDATE in a transaction with FOR
        //      UPDATE so two distinct webhook events for the same tenant
        //      can't race lost-update style.
        const sessionCustomerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;

        const result = await this.dataSource.transaction(async (tx) => {
          const [existing] = await tx.query(
            `SELECT id, tier, stripe_billing_customer_id
             FROM public.tenants WHERE id = $1 FOR UPDATE`,
            [tenantId],
          );
          if (!existing) {
            this.logger.warn(`checkout.session.completed for unknown tenant ${tenantId}`);
            return { action: 'skip' as const };
          }

          // Customer-binding check — refuses metadata-spoofed sessions.
          if (
            sessionCustomerId &&
            existing.stripe_billing_customer_id &&
            existing.stripe_billing_customer_id !== sessionCustomerId
          ) {
            this.logger.error(
              `checkout.session.completed tenant=${tenantId} expected_customer=${existing.stripe_billing_customer_id} session_customer=${sessionCustomerId} — REFUSING (metadata spoof?)`,
            );
            return { action: 'refused' as const };
          }

          const fromTier = existing.tier as 'standard' | 'premium' | 'enterprise';

          if (fromTier === targetTier) {
            if (subscriptionId) {
              await tx.query(
                `UPDATE public.tenants
                 SET stripe_billing_subscription_id = $1
                 WHERE id = $2 AND stripe_billing_subscription_id IS DISTINCT FROM $1`,
                [subscriptionId, tenantId],
              );
            }
            return { action: 'already_on_target' as const, fromTier };
          }

          await tx.query(
            `UPDATE public.tenants
             SET tier = $1, stripe_billing_subscription_id = COALESCE($2, stripe_billing_subscription_id)
             WHERE id = $3`,
            [targetTier, subscriptionId, tenantId],
          );

          // Audit row, written inside the same tx so a rollback drops it
          // too. AuditService can't be used here (it requires RLS context).
          if (actorUserId) {
            await tx.query(
              `INSERT INTO public.admin_audit_log
                 (tenant_id, actor_user_id, actor_role, action, resource_type,
                  resource_id, summary, metadata)
               VALUES (
                 $1, $2,
                 COALESCE(
                   (SELECT role FROM public.tenant_memberships
                     WHERE tenant_id = $1 AND user_id = $2),
                   'unknown'
                 ),
                 'tenant.tier_upgraded', 'church', $1, $3, $4::jsonb
               )`,
              [
                tenantId,
                actorUserId,
                `Church upgraded ${fromTier} → ${targetTier}`,
                JSON.stringify({
                  from: fromTier,
                  to: targetTier,
                  sessionId: session.id,
                  subscriptionId,
                }),
              ],
            );
          }
          return { action: 'upgraded' as const, fromTier };
        });

        if (result.action === 'upgraded') {
          this.logger.log(
            `Tenant ${tenantId} upgraded ${result.fromTier} → ${targetTier} (sub ${subscriptionId ?? 'unknown'})`,
          );
        } else if (result.action === 'already_on_target') {
          this.logger.log(
            `Tenant ${tenantId} already on ${targetTier} — recorded subscription only`,
          );
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        this.logger.log(`Charge refunded: ${charge.id}`);
        if (charge.payment_intent) {
          const piId = typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent.id;
          await this.dataSource.manager.update(
            Transaction,
            { stripePaymentIntentId: piId },
            { status: 'refunded' },
          );
          // Refund fundraiser donation (trigger auto-subtracts from fundraiser totals)
          await this.dataSource.manager.update(
            FundraiserDonation,
            { paymentIntentId: piId },
            { paymentStatus: 'refunded' },
          );
        }
        break;
      }

      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }
}
