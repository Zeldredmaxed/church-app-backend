import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { GivingController } from './giving.controller';
import { GivingService } from './giving.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [StripeModule],
  controllers: [GivingController],
  providers: [GivingService, RlsContextInterceptor],
})
export class GivingModule {}
