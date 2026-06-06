import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { ChallengesAdminController } from './challenges.admin.controller';
import { ChallengesScheduler } from './challenges.scheduler';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { RoleGuard } from '../common/guards/role.guard';

/**
 * Challenges / Faith Walks — pastor-authored multi-day reading plans,
 * completed in-app by members with streak tracking, points, and
 * Bronze/Silver/Gold/Mythic medals. Tables owned by migrations 096
 * (base) + 098 (gating/points/medals/leaderboard).
 */
@Module({
  imports: [AuditModule],
  controllers: [ChallengesController, ChallengesAdminController],
  providers: [ChallengesService, ChallengesScheduler, RlsContextInterceptor, RoleGuard],
})
export class ChallengesModule {}
