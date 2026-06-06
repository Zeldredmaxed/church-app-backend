import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { AuditModule } from '../audit/audit.module';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { ShopAdminController } from './shop.admin.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RoleGuard } from '../common/guards/role.guard';

/**
 * Shop — per-tenant church store. Tables owned by migration 088.
 *
 * StripeModule exports StripeService for the Connect-routed PaymentIntent.
 * AuditModule provides AuditService for admin + purchase audit entries.
 */
@Module({
  imports: [StripeModule, AuditModule],
  controllers: [ShopController, ShopAdminController],
  providers: [ShopService, RlsContextInterceptor, RoleGuard],
})
export class ShopModule {}
