import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [StoriesController],
  providers: [StoriesService, RlsContextInterceptor],
})
export class StoriesModule {}
