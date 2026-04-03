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
  readonly stripe: Stripe;
  readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      {
        apiVersion: '2024-06-20',
        appInfo: {
          name: 'ChurchApp Platform',
          version: '1.0.0',
        },
      },
    );

    this.webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  /**
   * Creates a Stripe Connect account for a church tenant.
   * Uses the Standard Connect type — churches manage their own Stripe dashboard.
   */
  async createConnectAccount(tenantName: string): Promise<Stripe.Account> {
    return this.stripe.accounts.create({
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
    return this.stripe.accountLinks.create({
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
    return this.stripe.accounts.retrieve(accountId);
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
    return this.stripe.paymentIntents.create({
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
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
