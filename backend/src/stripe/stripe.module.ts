import { Module, forwardRef } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeCheckoutController } from './stripe-checkout.controller';
import { StripePaymentMethodsController } from './stripe-payment-methods.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RoleGuard } from '../common/guards/role.guard';
import { AuditModule } from '../audit/audit.module';
import { TenantsModule } from '../tenants/tenants.module';
import { MarketplaceModule } from '../workflow-marketplace/marketplace.module';

/**
 * StripeModule — Stripe Connect onboarding + plan-upgrade checkout +
 * webhook handler + user-facing saved-card management.
 *
 * The StripeService is exported so GivingModule can use the Stripe client
 * for creating PaymentIntents.
 *
 * forwardRef(TenantsModule): the new-tenant signup flow has a two-way
 * dep — TenantsService creates the Stripe Checkout session, and the
 * webhook fires back into TenantsService.completeSignup. forwardRef
 * is the canonical NestJS pattern for this.
 */
@Module({
  imports: [AuditModule, forwardRef(() => TenantsModule), forwardRef(() => MarketplaceModule)],
  controllers: [
    StripeConnectController,
    StripeCheckoutController,
    StripeWebhookController,
    StripePaymentMethodsController,
  ],
  providers: [StripeService, RlsContextInterceptor, RoleGuard],
  exports: [StripeService],
})
export class StripeModule {}
