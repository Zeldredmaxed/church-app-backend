import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    AuditModule,
  ],
  controllers: [EventsController],
  providers: [EventsService, RlsContextInterceptor],
})
export class EventsModule {}
