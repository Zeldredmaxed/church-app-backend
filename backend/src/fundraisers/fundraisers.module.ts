import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FundraisersController } from './fundraisers.controller';
import { FundraisersService } from './fundraisers.service';
import { StripeModule } from '../stripe/stripe.module';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    StripeModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [FundraisersController],
  providers: [FundraisersService, RlsContextInterceptor],
})
export class FundraisersModule {}
