import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, RlsContextInterceptor],
})
export class FeedbackModule {}
