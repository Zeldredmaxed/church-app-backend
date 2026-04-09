import { Module } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { EmailService } from '../communications/email.service';
import { SmsService } from '../communications/sms.service';
import { OneSignalService } from '../notifications/onesignal.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    WorkflowEngineService,
    EmailService,
    SmsService,
    OneSignalService,
    RlsContextInterceptor,
  ],
  exports: [WorkflowEngineService],
})
export class WorkflowsModule {}
