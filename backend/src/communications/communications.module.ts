import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [CommunicationsController],
  providers: [CommunicationsService, RlsContextInterceptor],
})
export class CommunicationsModule {}
