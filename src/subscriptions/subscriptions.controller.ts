import { Controller, Post, Get, Body, Param, UseGuards, Headers } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Stripe price IDs - Replace with your real Stripe Price IDs
const DEFAULT_PRICE_ID = 'price_1234567890';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // POST /subscriptions/create-checkout
  // Create a checkout session - NO AUTH REQUIRED (public checkout)
  @Post('create-checkout')
  async createCheckout(
    @Body() body: { 
      churchName: string; 
      email: string; 
      phone?: string;
      priceId?: string 
    }
  ) {
    // Generate a simple ID from church name
    const churchId = body.churchName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now();
    
    const priceId = body.priceId || DEFAULT_PRICE_ID;
    
    try {
      const result = await this.subscriptionsService.createCheckoutSession(
        priceId,
        churchId,
        body.churchName,
        body.email,
        body.phone
      );
      return result;
    } catch (error) {
      console.error('Stripe checkout error:', error);
      return { error: 'Failed to create checkout session' };
    }
  }

  // POST /subscriptions/webhook
  // Handle Stripe webhooks
  @Post('webhook')
  async handleWebhook(@Body() body: any) {
    const eventType = body.type;
    const data = body.data?.object;

    console.log(`Received webhook: ${eventType}`);

    switch (eventType) {
      case 'checkout.session.completed':
        console.log('Payment completed for:', data?.metadata?.churchId);
        // TODO: Update church subscription in database
        break;

      case 'customer.subscription.deleted':
        console.log('Subscription cancelled for:', data?.customer);
        // TODO: Update church subscription in database
        break;

      case 'invoice.payment_failed':
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
  async getSubscriptionStatus(@Param('churchId') churchId: string) {
    // TODO: Query database for church subscription status
    return {
      churchId,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  // POST /subscriptions/cancel
  // Cancel subscription
  @Post('cancel')
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
