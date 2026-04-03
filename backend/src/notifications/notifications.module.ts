import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { OneSignalService } from './onesignal.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    OneSignalService,
    RlsContextInterceptor,
  ],
  exports: [BullModule, OneSignalService],
})
export class NotificationsModule {}
