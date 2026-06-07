import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  // forwardRef breaks the circular dep:
  //   MarketplaceService → StripeService (for createMarketplaceInstallSession)
  //   StripeWebhookController → MarketplaceService (for installTemplate
  //     on checkout.session.completed metadata.flow=marketplace_install)
  imports: [forwardRef(() => StripeModule)],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, RlsContextInterceptor],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
