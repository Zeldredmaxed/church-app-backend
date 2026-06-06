import { Module } from '@nestjs/common';
import { LeaderboardController, CheckinConfigController, GeoCheckinController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CacheService } from '../common/services/cache.service';

@Module({
  controllers: [LeaderboardController, CheckinConfigController, GeoCheckinController],
  providers: [LeaderboardService, RlsContextInterceptor, CacheService],
})
export class LeaderboardModule {}
