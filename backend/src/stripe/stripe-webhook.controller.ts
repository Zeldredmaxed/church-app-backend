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
import { DataSource } from 'typeorm';
import { StripeService } from './stripe.service';
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

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(`PaymentIntent succeeded: ${pi.id}`);
        // Update giving transactions
        await this.dataSource.manager.update(
          Transaction,
          { stripePaymentIntentId: pi.id },
          { status: 'succeeded' },
        );
        // Update fundraiser donations (trigger auto-updates fundraiser totals)
        await this.dataSource.manager.update(
          FundraiserDonation,
          { paymentIntentId: pi.id },
          { paymentStatus: 'succeeded' },
        );
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
}
