import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeCheckoutController } from './stripe-checkout.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RoleGuard } from '../common/guards/role.guard';
import { AuditModule } from '../audit/audit.module';

/**
 * StripeModule — Stripe Connect onboarding + plan-upgrade checkout +
 * webhook handler.
 *
 * The StripeService is exported so GivingModule can use the Stripe client
 * for creating PaymentIntents.
 */
@Module({
  imports: [AuditModule],
  controllers: [StripeConnectController, StripeCheckoutController, StripeWebhookController],
  providers: [StripeService, RlsContextInterceptor, RoleGuard],
  exports: [StripeService],
})
export class StripeModule {}
