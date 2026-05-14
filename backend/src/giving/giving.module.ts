import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { GivingController } from './giving.controller';
import { GivingService } from './giving.service';
import { CacheService } from '../common/services/cache.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [StripeModule, AuditModule],
  controllers: [GivingController],
  providers: [GivingService, CacheService, RlsContextInterceptor],
})
export class GivingModule {}
