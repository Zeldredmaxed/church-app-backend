import { Module } from '@nestjs/common';
import { VolunteerController } from './volunteer.controller';
import { VolunteerService } from './volunteer.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [VolunteerController],
  providers: [VolunteerService, RlsContextInterceptor],
})
export class VolunteerModule {}
