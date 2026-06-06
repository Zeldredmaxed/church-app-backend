import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiScheduler } from './ai.scheduler';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [AiController],
  providers: [AiService, AiScheduler, RlsContextInterceptor],
  exports: [AiService],
})
export class AiModule {}
