import { Module } from '@nestjs/common';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [CheckinController],
  providers: [CheckinService, RlsContextInterceptor],
})
export class CheckinModule {}
