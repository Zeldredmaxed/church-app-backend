import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuditModule, UsersModule],
  controllers: [GroupsController],
  providers: [GroupsService, RlsContextInterceptor],
})
export class GroupsModule {}
