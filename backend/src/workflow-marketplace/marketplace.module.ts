import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [MarketplaceController],
  providers: [MarketplaceService, RlsContextInterceptor],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
