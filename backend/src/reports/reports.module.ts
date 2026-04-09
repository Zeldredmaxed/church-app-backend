import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, RlsContextInterceptor],
})
export class ReportsModule {}
