import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [FacilitiesController],
  providers: [FacilitiesService, RlsContextInterceptor],
})
export class FacilitiesModule {}
