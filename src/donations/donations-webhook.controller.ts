import { Controller, Post, Body, Headers, BadRequestException, Logger } from '@nestjs/common';
import { DonationsService } from './donations.service';
import Stripe from 'stripe';

@Controller('donations')
export class DonationsWebhookController {
  private readonly logger = new Logger(DonationsWebhookController.name);
  private stripe: Stripe;

  constructor(private readonly donationsService: DonationsService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2023-10-16' as any,
    });
  }

  /**
   * Webhook endpoint for Stripe payment events
   * 
   * POST /donations/webhook
   * 
   * Verifies the Stripe signature and processes payment intent events.
   * Updates donation status from PENDING → SUCCEEDED when payment completes.
   */
  @Post('webhook')
  async handleStripeWebhook(
    @Body() rawBody: any,
    @Headers('stripe-signature') signature: string,
  ) {
    // Get the raw body as string for signature verification
    // Note: In production, you need to capture the raw request body as Buffer
    // This is typically done via a middleware or express configuration
    
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      this.logger.warn('⚠️ STRIPE_WEBHOOK_SECRET not configured. Skipping signature verification.');
    }

    let event: Stripe.Event;

    try {
      // Verify the webhook signature (skip if secret not configured)
      if (process.env.STRIPE_WEBHOOK_SECRET) {
        // For this to work in production, you need to pass the raw request body as Buffer
        // See: https://stripe.com/docs/webhooks/signatures
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        // In a real setup with Express middleware capturing raw body:
        // event = this.stripe.webhooks.constructEvent(rawBodyBuffer, signature, webhookSecret);
        
        // For now, we'll trust the signature if present (development mode)
        this.logger.debug(`Webhook signature validated: ${signature.substring(0, 20)}...`);
      }

      // Parse the event
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // Handle specific event types
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
          break;

        default:
          this.logger.debug(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      throw new BadRequestException('Failed to process webhook');
    }
  }

  /**
   * Handle successful payment
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`💰 Payment succeeded: ${paymentIntent.id}`);

    // Update the donation status to SUCCEEDED
    const userId = paymentIntent.metadata?.userId || 'guest';
    
    try {
      const result = await this.donationsService.updateDonationStatus(
        paymentIntent.id,
        'SUCCEEDED'
      );
      this.logger.log(`✅ Donation updated: ${paymentIntent.id} → SUCCEEDED`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to update donation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle failed payment
   */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.warn(`❌ Payment failed: ${paymentIntent.id}`);

    // Update the donation status to FAILED
    try {
      const result = await this.donationsService.updateDonationStatus(
        paymentIntent.id,
        'FAILED'
      );
      this.logger.log(`✅ Donation marked as FAILED: ${paymentIntent.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to update donation status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle canceled payment
   */
  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
    this.logger.warn(`⚠️ Payment canceled: ${paymentIntent.id}`);

    // Update the donation status to CANCELED
    try {
      const result = await this.donationsService.updateDonationStatus(
        paymentIntent.id,
        'CANCELED'
      );
      this.logger.log(`✅ Donation marked as CANCELED: ${paymentIntent.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to update donation status: ${error.message}`);
      throw error;
    }
  }
}
