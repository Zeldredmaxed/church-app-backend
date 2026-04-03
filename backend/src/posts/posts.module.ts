import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'social-fanout' }),
  ],
  controllers: [PostsController],
  providers: [PostsService, RlsContextInterceptor],
})
export class PostsModule {}
