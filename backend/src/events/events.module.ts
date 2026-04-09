import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [EventsController],
  providers: [EventsService, RlsContextInterceptor],
})
export class EventsModule {}
