import { Module } from '@nestjs/common';
import { FamilyController, AdminFamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NotificationsModule, AuditModule],
  controllers: [FamilyController, AdminFamilyController],
  providers: [FamilyService, RlsContextInterceptor],
})
export class FamilyModule {}
