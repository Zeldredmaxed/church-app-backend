import { Module } from '@nestjs/common';
import { RecurringGivingController } from './recurring-giving.controller';
import { RecurringGivingService } from './recurring-giving.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [RecurringGivingController],
  providers: [RecurringGivingService, RlsContextInterceptor],
})
export class RecurringGivingModule {}
