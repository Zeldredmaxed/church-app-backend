import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [MembershipsController],
  providers: [MembershipsService, RlsContextInterceptor],
})
export class MembershipsModule {}
