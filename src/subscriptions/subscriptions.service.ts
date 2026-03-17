import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe;

  constructor() {
    // Initialize Stripe with your secret key
    // Get this from Stripe Dashboard: https://dashboard.stripe.com/apikeys
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_your_key_here', {
      apiVersion: '2026-02-25.clover',
    });
  }

  // Create a checkout session for subscription
  async createCheckoutSession(priceId: string, churchId: string, churchName: string) {
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId, // Create this in Stripe Dashboard
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://newbirthpwc.org'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://newbirthpwc.org'}/cancel`,
      metadata: {
        churchId,
        churchName,
      },
    });

    return { url: session.url, sessionId: session.id };
  }

  // Create a customer in Stripe
  async createCustomer(churchId: string, email: string, churchName: string) {
    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        churchId,
        churchName,
      },
    });

    return customer;
  }

  // Get subscription details
  async getSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  // Cancel subscription
  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  // Get customer by Stripe ID
  async getCustomer(customerId: string) {
    return this.stripe.customers.retrieve(customerId);
  }

  // Handle webhook
  constructWebhookEvent(payload: Buffer, signature: string) {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || 'whsec_your_webhook_secret',
    );
  }
}
