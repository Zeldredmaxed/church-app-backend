import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { OneSignalService } from '../notifications/onesignal.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [CommunicationsController],
  providers: [
    CommunicationsService,
    EmailService,
    SmsService,
    OneSignalService,
    RlsContextInterceptor,
  ],
})
export class CommunicationsModule {}
