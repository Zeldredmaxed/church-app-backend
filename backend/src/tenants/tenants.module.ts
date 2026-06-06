import { Module, forwardRef } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { CampusController } from './campus.controller';
import { CampusService } from './campus.service';
import { CacheService } from '../common/services/cache.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  // forwardRef breaks the circular dep:
  //   TenantsService → StripeService (for startSignup → Checkout)
  //   StripeWebhookController → TenantsService (for completeSignup on
  //     checkout.session.completed firing for new-tenant signup)
  imports: [forwardRef(() => StripeModule)],
  controllers: [TenantsController, CampusController],
  providers: [TenantsService, CampusService, CacheService, RlsContextInterceptor],
  exports: [CampusService, TenantsService],
})
export class TenantsModule {}
