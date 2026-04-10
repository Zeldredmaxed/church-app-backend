import { Module } from '@nestjs/common';
import { LeaderboardController, CheckinConfigController, GeoCheckinController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [LeaderboardController, CheckinConfigController, GeoCheckinController],
  providers: [LeaderboardService, RlsContextInterceptor],
})
export class LeaderboardModule {}
