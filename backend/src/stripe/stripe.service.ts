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
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: destinationAccountId,
      },
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
