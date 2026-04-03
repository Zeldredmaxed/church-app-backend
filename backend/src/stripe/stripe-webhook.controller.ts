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
import { StripeService } from './stripe.service';
import Stripe from 'stripe';

@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly stripeService: StripeService) {}

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

    switch (event.type) {
      case 'payment_intent.succeeded':
        this.logger.log(
          `PaymentIntent succeeded: ${(event.data.object as Stripe.PaymentIntent).id}`,
        );
        break;

      case 'payment_intent.payment_failed':
        this.logger.log(
          `PaymentIntent failed: ${(event.data.object as Stripe.PaymentIntent).id}`,
        );
        break;

      case 'account.updated':
        this.logger.log(
          `Connect account updated: ${(event.data.object as Stripe.Account).id}`,
        );
        break;

      case 'charge.refunded':
        this.logger.log(
          `Charge refunded: ${(event.data.object as Stripe.Charge).id}`,
        );
        break;

      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return { received: true };
  }
}
