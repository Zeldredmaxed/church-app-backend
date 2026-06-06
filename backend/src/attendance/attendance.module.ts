import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ServicesController, AttendanceMemberController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceScheduler } from './attendance.scheduler';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    AuditModule,
  ],
  controllers: [ServicesController, AttendanceMemberController],
  providers: [AttendanceService, AttendanceScheduler, RlsContextInterceptor],
})
export class AttendanceModule {}
