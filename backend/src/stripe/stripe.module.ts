import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

/**
 * StripeModule — Stripe Connect onboarding + webhook handler.
 *
 * The StripeService is exported so GivingModule can use the Stripe client
 * for creating PaymentIntents.
 */
@Module({
  controllers: [StripeConnectController, StripeWebhookController],
  providers: [StripeService, RlsContextInterceptor],
  exports: [StripeService],
})
export class StripeModule {}
