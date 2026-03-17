import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_your_key_here', {
      apiVersion: '2026-02-25.clover',
    });
  }

  // Create a checkout session for subscription
  async createCheckoutSession(
    priceId: string, 
    churchId: string, 
    churchName: string,
    email?: string,
    phone?: string
  ) {
    // Create or get customer
    let customerId: string;
    
    // Check if customer already exists by email
    if (email) {
      const existingCustomers = await this.stripe.customers.list({
        email,
        limit: 1
      });
      
      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const customer = await this.stripe.customers.create({
          email,
          name: churchName,
          phone: phone || undefined,
          metadata: {
            churchId,
            churchName
          }
        });
        customerId = customer.id;
      }
    } else {
      const customer = await this.stripe.customers.create({
        name: churchName,
        metadata: {
          churchId,
          churchName
        }
      });
      customerId = customer.id;
    }

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://Zeldredmaxed.github.io/cornerstone-legacy'}/success.html`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://Zeldredmaxed.github.io/cornerstone-legacy'}/cancel.html`,
      metadata: {
        churchId,
        churchName
      },
      allow_promotion_codes: true,
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
