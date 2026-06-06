import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { ChallengesAdminController } from './challenges.admin.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RoleGuard } from '../common/guards/role.guard';

/**
 * Challenges & Reading Plans — Bible.com-style multi-day plans authored
 * by pastors, completed in-app by members with streak tracking. Tables
 * owned by migrations/096_challenges_reading_plans.sql.
 */
@Module({
  imports: [AuditModule],
  controllers: [ChallengesController, ChallengesAdminController],
  providers: [ChallengesService, RlsContextInterceptor, RoleGuard],
})
export class ChallengesModule {}
