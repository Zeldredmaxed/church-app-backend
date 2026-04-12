import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { ExpoPushService } from './expo-push.service';
import { OneSignalService } from './onesignal.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 1000,
        removeOnFail: { age: 604800 }, // keep failed 7 days
      },
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    ExpoPushService,
    OneSignalService,
    RlsContextInterceptor,
  ],
  exports: [BullModule, ExpoPushService, OneSignalService],
})
export class NotificationsModule {}
