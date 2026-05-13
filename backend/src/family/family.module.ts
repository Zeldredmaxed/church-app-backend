import { Module } from '@nestjs/common';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [FamilyController],
  providers: [FamilyService, RlsContextInterceptor],
})
export class FamilyModule {}
