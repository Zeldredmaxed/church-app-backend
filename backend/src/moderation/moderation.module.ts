import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { UserSafetyController } from './user-safety.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [ModerationController, UserSafetyController],
  providers: [ModerationService, RlsContextInterceptor],
})
export class ModerationModule {}
