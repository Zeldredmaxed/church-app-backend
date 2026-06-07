import {
  Controller,
  Post,
  Req,
  Inject,
  forwardRef,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { StripeService } from './stripe.service';
import { TenantsService } from '../tenants/tenants.service';
import { MarketplaceService } from '../workflow-marketplace/marketplace.service';
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
    private readonly config: ConfigService,
    @Inject(forwardRef(() => TenantsService))
    private readonly tenantsService: TenantsService,
    @Inject(forwardRef(() => MarketplaceService))
    private readonly marketplaceService: MarketplaceService,
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
        await this.dataSource.manager.update(
          Transaction,
          { stripePaymentIntentId: pi.id },
          { status: 'succeeded' },
        );
        await this.dataSource.manager.update(
          FundraiserDonation,
          { paymentIntentId: pi.id },
          { paymentStatus: 'succeeded' },
        );
        // Shop orders: flip pending → paid and decrement stock in a
        // single transaction. The conditional UPDATE on shop_items
        // races safely — concurrent webhooks for two different orders
        // each get an authoritative row-count from RETURNING.
        await this.dataSource.transaction(async (tx) => {
          const orderRows = await tx.query(
            `UPDATE public.shop_orders
             SET status = 'paid', paid_at = now()
             WHERE stripe_payment_intent_id = $1 AND status = 'pending'
             RETURNING item_id, quantity`,
            [pi.id],
          );
          if (orderRows.length > 0) {
            const { item_id, quantity } = orderRows[0];
            await tx.query(
              `UPDATE public.shop_items
               SET stock = stock - $2
               WHERE id = $1 AND stock IS NOT NULL AND stock >= $2`,
              [item_id, quantity],
            );
            this.logger.log(`Shop order for PI ${pi.id} settled (item ${item_id} -${quantity})`);
          }
        });
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
        // Restock the order's units in the same tx that flips the
        // order to 'failed'. Stock was reserved at purchase-time before
        // we created the PI (shop.service line 311); a charge failure
        // means we owe the units back. RETURNING gates the restock on
        // an actual row transition so a duplicate webhook can't
        // double-restock.
        await this.dataSource.transaction(async (tx) => {
          const orderRows = await tx.query(
            `UPDATE public.shop_orders SET status = 'failed'
             WHERE stripe_payment_intent_id = $1 AND status = 'pending'
             RETURNING item_id, quantity`,
            [pi.id],
          );
          if (orderRows.length > 0) {
            const { item_id, quantity } = orderRows[0];
            await tx.query(
              `UPDATE public.shop_items
               SET stock = stock + $2, in_stock = true, updated_at = now()
               WHERE id = $1 AND stock IS NOT NULL`,
              [item_id, quantity],
            );
          }
        });
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

        // Dispatch by metadata.flow.
        //   'new_tenant_signup' (mig 100)   → materialize tenant + admin
        //   'marketplace_install' (mig 102) → install workflow template
        //   undefined                       → plan-upgrade flow (back-compat)
        const flow = session.metadata?.flow;
        if (flow === 'new_tenant_signup') {
          await this.handleNewTenantSignupCompletion(session);
          break;
        }
        if (flow === 'marketplace_install') {
          await this.handleMarketplaceInstallCompletion(session);
          break;
        }

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

  /**
   * Handler for checkout.session.completed when metadata.flow ===
   * 'new_tenant_signup' (migration 100). Materializes the tenant +
   * founding admin from session metadata; idempotent via the
   * tenant_signup_completions dedupe table (PK = stripe_session_id),
   * so Stripe webhook retries return the same tenant without
   * double-creation.
   *
   * Reads the session metadata for the pending tenant fields and
   * delegates to TenantsService.completeSignup which does the heavy
   * lifting (Supabase user create, tenant insert, founding admin
   * membership, magic-link email).
   */
  private async handleNewTenantSignupCompletion(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const m = session.metadata ?? {};

    // Defensive parse: any missing field is a schema drift between
    // our Checkout creation and this handler. THROW (not return) so
    // Stripe retries — silently ACKing 200 means the customer paid,
    // their subscription is active, no tenant was created, and the
    // only signal is a log line. Retry storm > stranded paying customer.
    const required = [
      'churchName', 'adminFullName', 'adminEmail', 'tier',
      'addressStreet', 'addressCity', 'addressState', 'addressPostalCode',
    ];
    for (const k of required) {
      if (!m[k]) {
        const msg = `new_tenant_signup webhook missing metadata.${k} (session ${session.id})`;
        this.logger.error(msg);
        throw new Error(msg);
      }
    }

    const address = {
      street: m.addressStreet as string,
      city: m.addressCity as string,
      state: m.addressState as string,
      postalCode: m.addressPostalCode as string,
      country: (m.addressCountry as string) || 'US',
    };

    const sessionCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? null;

    if (!sessionCustomerId) {
      const msg = `new_tenant_signup webhook: session ${session.id} has no customer id — refusing (cannot bill later)`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    // welcomeBaseUrl → admin dashboard (where /welcome consumes the
    // Supabase magic-link hash). PUBLIC_SITE_URL is the marketing site
    // and would land the founding admin on a 404.
    const welcomeBaseUrl =
      this.config.get<string>('ADMIN_DASHBOARD_URL') ?? 'https://admin.shepard.love';

    try {
      const result = await this.tenantsService.completeSignup({
        stripeSessionId: session.id,
        stripeCustomerId: sessionCustomerId,
        stripeSubscriptionId: subscriptionId,
        churchName: m.churchName as string,
        adminFullName: m.adminFullName as string,
        adminEmail: m.adminEmail as string,
        tier: m.tier as 'standard' | 'premium' | 'enterprise',
        address,
        welcomeBaseUrl,
      });
      if (result.alreadyCompleted) {
        this.logger.log(
          `new_tenant_signup webhook: session ${session.id} retry — tenant ${result.tenantId} already created`,
        );
      } else {
        this.logger.log(
          `new_tenant_signup webhook: created tenant ${result.tenantId} + admin ${result.adminUserId} for ${m.adminEmail}`,
        );
      }
    } catch (err: any) {
      // Don't ack the webhook on failure — Stripe will retry, and the
      // dedupe row only writes on success, so the retry will actually
      // run the create path again.
      this.logger.error(
        `new_tenant_signup webhook FAILED for session ${session.id}: ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * Handler for checkout.session.completed when metadata.flow ===
   * 'marketplace_install' (migration 102). Installs the paid workflow
   * template into the buyer's tenant. Idempotent — re-running the
   * install for an already-installed (tenant, template) returns the
   * existing workflow row via ON CONFLICT on workflow_template_installs.
   */
  private async handleMarketplaceInstallCompletion(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const m = session.metadata ?? {};
    const tenantId = m.tenantId as string | undefined;
    const templateId = m.templateId as string | undefined;
    const userId = m.userId as string | undefined;

    if (!tenantId || !templateId || !userId) {
      const msg = `marketplace_install webhook missing metadata (session ${session.id}): tenantId=${tenantId} templateId=${templateId} userId=${userId}`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    try {
      const result = await this.marketplaceService.installTemplate(tenantId, templateId, userId);
      this.logger.log(
        `marketplace_install webhook: installed template ${templateId} for tenant ${tenantId} → workflow ${result.workflowId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `marketplace_install webhook FAILED for session ${session.id}: ${err.message}`,
      );
      throw err;
    }
  }
}
