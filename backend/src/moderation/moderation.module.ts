import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [ModerationController],
  providers: [ModerationService, RlsContextInterceptor],
})
export class ModerationModule {}
