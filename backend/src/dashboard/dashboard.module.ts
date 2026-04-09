import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, RlsContextInterceptor],
})
export class DashboardModule {}
