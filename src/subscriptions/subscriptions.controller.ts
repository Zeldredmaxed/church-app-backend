import { Controller, Post, Get, Body, Param, UseGuards, Headers, RawBodyRequest, Req } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Stripe price IDs - Create these in Stripe Dashboard
// Example: $29/month for church subscription
const CHURCH_SUBSCRIPTION_PRICE_ID = 'price_1234567890'; // Replace with real Stripe price ID

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // POST /subscriptions/create-checkout
  // Create a checkout session for the church to subscribe
  @Post('create-checkout')
  @UseGuards(JwtAuthGuard)
  async createCheckout(
    @Body() body: { churchId: string; churchName: string; priceId?: string }
  ) {
    const priceId = body.priceId || CHURCH_SUBSCRIPTION_PRICE_ID;
    
    try {
      const result = await this.subscriptionsService.createCheckoutSession(
        priceId,
        body.churchId,
        body.churchName,
      );
      return result;
    } catch (error) {
      console.error('Stripe checkout error:', error);
      return { error: 'Failed to create checkout session' };
    }
  }

  // POST /subscriptions/webhook
  // Handle Stripe webhooks (payment succeeded, failed, etc.)
  @Post('webhook')
  async handleWebhook(
    @Body() body: any,
    @Headers('stripe-signature') signature: string
  ) {
    // Note: In production, verify the webhook signature
    // For now, we'll handle basic events
    
    const eventType = body.type;
    const data = body.data?.object;

    console.log(`Received webhook: ${eventType}`);

    switch (eventType) {
      case 'checkout.session.completed':
        // Payment successful - grant access
        console.log('Payment completed for:', data?.metadata?.churchId);
        // TODO: Update church subscription status in database
        break;

      case 'customer.subscription.deleted':
        // Subscription cancelled - revoke access
        console.log('Subscription cancelled for:', data?.customer);
        // TODO: Update church subscription status in database
        break;

      case 'invoice.payment_failed':
        // Payment failed - notify church
        console.log('Payment failed for:', data?.customer);
        // TODO: Send notification to church
        break;

      default:
        console.log(`Unhandled event: ${eventType}`);
    }

    return { received: true };
  }

  // GET /subscriptions/status/:churchId
  // Check if church has active subscription
  @Get('status/:churchId')
  @UseGuards(JwtAuthGuard)
  async getSubscriptionStatus(@Param('churchId') churchId: string) {
    // TODO: Query database for church subscription status
    // For now, return placeholder
    return {
      churchId,
      status: 'active', // or 'inactive', 'past_due', etc.
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  // POST /subscriptions/cancel
  // Cancel subscription
  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  async cancelSubscription(@Body() body: { subscriptionId: string }) {
    try {
      const result = await this.subscriptionsService.cancelSubscription(body.subscriptionId);
      return { success: true, result };
    } catch (error) {
      console.error('Cancel subscription error:', error);
      return { error: 'Failed to cancel subscription' };
    }
  }
}
