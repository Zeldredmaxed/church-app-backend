import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Core Stripe SDK wrapper.
 *
 * Provides the configured Stripe client to all modules that need it.
 * The Stripe secret key is injected from environment variables.
 *
 * All Stripe API calls should go through this service to ensure
 * consistent configuration (API version, app info, etc.).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  readonly stripe: Stripe | null;
  readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey && !stripeKey.includes('placeholder')) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2024-06-20',
        appInfo: { name: 'ChurchApp Platform', version: '1.0.0' },
      });
    } else {
      this.stripe = null;
      this.logger.warn('STRIPE_SECRET_KEY not configured — Stripe features disabled');
    }

    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  private ensureStripe(): Stripe {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe;
  }

  async createConnectAccount(tenantName: string): Promise<Stripe.Account> {
    return this.ensureStripe().accounts.create({
      type: 'standard',
      business_profile: {
        name: tenantName,
      },
    });
  }

  /**
   * Creates an Account Link for Stripe Connect onboarding.
   * The frontend redirects the admin to this URL to complete onboarding.
   */
  async createAccountLink(
    accountId: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<Stripe.AccountLink> {
    return this.ensureStripe().accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  /**
   * Retrieves a Stripe Connect account to check onboarding status.
   */
  async getAccount(accountId: string): Promise<Stripe.Account> {
    return this.ensureStripe().accounts.retrieve(accountId);
  }

  /**
   * Creates a PaymentIntent for a donation with platform fee.
   *
   * Uses Stripe Connect's `transfer_data.destination` to route the payment
   * to the church's connected account, minus the platform fee.
   *
   * @param amountCents - Amount in cents (e.g., 10000 = $100.00)
   * @param currency - Three-letter ISO currency code
   * @param destinationAccountId - The church's Stripe Connect account ID
   * @param platformFeeCents - Platform fee in cents (deducted from the payment)
   */
  async createPaymentIntent(
    amountCents: number,
    currency: string,
    destinationAccountId: string,
    platformFeeCents: number,
  ): Promise<Stripe.PaymentIntent> {
    return this.ensureStripe().paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true }, // Enables card, Apple Pay, Google Pay, Link
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: destinationAccountId,
      },
    });
  }

  /**
   * Retrieves an existing PaymentIntent. Used by the fundraiser-donate
   * retry path: if we still have a pending donation in our DB whose PI
   * Stripe still considers reusable (requires_payment_method / _confirmation
   * / _action), we reuse it rather than creating a new one — preventing
   * double-credit when the mobile retries POST /donate.
   */
  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.ensureStripe().paymentIntents.retrieve(paymentIntentId);
  }

  /**
   * Refunds a captured PaymentIntent. Used by the in-app donation refund
   * flow (admin / accountant moderating gifts). Returns the Refund object
   * so the caller can pull amount, currency, and reason for the audit log.
   */
  async refundPaymentIntent(
    paymentIntentId: string,
    options?: { amount?: number; reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer' },
  ): Promise<Stripe.Refund> {
    return this.ensureStripe().refunds.create({
      payment_intent: paymentIntentId,
      ...(options?.amount ? { amount: options.amount } : {}),
      ...(options?.reason ? { reason: options.reason } : {}),
    });
  }

  /**
   * Fetches Connect account health for the admin dashboard.
   * Returns the live Account object so the dashboard can show
   * charges_enabled / payouts_enabled / requirements / next payout.
   */
  async retrieveConnectAccount(accountId: string): Promise<Stripe.Account> {
    return this.ensureStripe().accounts.retrieve(accountId);
  }

  async listConnectPayouts(accountId: string, limit = 10): Promise<Stripe.ApiList<Stripe.Payout>> {
    return this.ensureStripe().payouts.list(
      { limit },
      { stripeAccount: accountId },
    );
  }

  async getConnectBalance(accountId: string): Promise<Stripe.Balance> {
    return this.ensureStripe().balance.retrieve({ stripeAccount: accountId });
  }

  /**
   * Recurring giving: create a Subscription on the church's Connect
   * account that bills the customer's default payment method on the
   * given interval. Uses inline `price_data` so we don't have to
   * pre-create Price objects per (amount, frequency, fund) combination.
   *
   * application_fee_percent routes the platform cut to us — same
   * arrangement as PaymentIntent transfers but expressed as percent on
   * subscriptions.
   */
  async createSubscription(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    destinationAccountId: string;
    platformFeePercent: number;
    metadata?: Record<string, string>;
    /** Stripe idempotency key — same key replays return the same sub */
    idempotencyKey?: string;
  }): Promise<Stripe.Subscription> {
    const intervalMap: Record<typeof params.frequency, { interval: 'week' | 'month'; count: number }> = {
      weekly: { interval: 'week', count: 1 },
      biweekly: { interval: 'week', count: 2 },
      monthly: { interval: 'month', count: 1 },
    };
    const interval = intervalMap[params.frequency];
    const stripe = this.ensureStripe();

    // Subscriptions need a Price tied to a Product. Stripe's PriceData
    // inline shape only accepts `product: <id>`, not `product_data:
    // { name }`. So we two-step: create a Price (which accepts inline
    // product_data) then attach it to the subscription via `price`.
    // The product/price live on the platform account, not the Connect
    // account — that's correct because the platform owns the catalog.
    //
    // idempotencyKey is forwarded to both calls. Stripe's idempotency
    // is API-method-scoped, so the same key reused on prices.create
    // and subscriptions.create won't collide — each method has its own
    // idempotency table. Caller derives the key from
    // (userId, amount, frequency, fund, minute-bucket) so a mobile
    // retry within the same minute returns the same sub.
    const price = await stripe.prices.create(
      {
        currency: params.currency,
        unit_amount: params.amountCents,
        recurring: { interval: interval.interval, interval_count: interval.count },
        product_data: { name: `Recurring gift (${params.frequency})` },
      },
      params.idempotencyKey ? { idempotencyKey: `${params.idempotencyKey}:price` } : undefined,
    );

    return stripe.subscriptions.create(
      {
        customer: params.customerId,
        default_payment_method: params.paymentMethodId,
        items: [{ price: price.id }],
        application_fee_percent: params.platformFeePercent,
        transfer_data: { destination: params.destinationAccountId },
        collection_method: 'charge_automatically',
        metadata: params.metadata ?? {},
      },
      params.idempotencyKey ? { idempotencyKey: `${params.idempotencyKey}:sub` } : undefined,
    );
  }

  async pauseSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.ensureStripe().subscriptions.update(subscriptionId, {
      pause_collection: { behavior: 'void' },
    });
  }

  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.ensureStripe().subscriptions.update(subscriptionId, {
      pause_collection: null,
    });
  }

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.ensureStripe().subscriptions.cancel(subscriptionId);
  }

  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return this.ensureStripe().paymentMethods.retrieve(paymentMethodId);
  }

  /** Attaches a PaymentMethod to a Customer (idempotent if already attached). */
  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<Stripe.PaymentMethod> {
    return this.ensureStripe().paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  /**
   * Creates a Stripe Customer for the given email.
   * Called lazily on first SetupIntent creation.
   */
  async createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
    return this.ensureStripe().customers.create({
      email,
      name: name ?? undefined,
    });
  }

  /**
   * Creates a SetupIntent for saving a payment method to a customer.
   * The frontend uses the returned client_secret with Stripe.js CardField.
   */
  async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    return this.ensureStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
  }

  /**
   * Verifies a Stripe webhook signature and returns the parsed event.
   * Throws Stripe.errors.StripeSignatureVerificationError on failure.
   */
  constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
  ): Stripe.Event {
    return this.ensureStripe().webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
