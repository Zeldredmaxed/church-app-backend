import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, RlsContextInterceptor],
})
export class AssistantModule {}
