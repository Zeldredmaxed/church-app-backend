import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [ChatController],
  providers: [ChatService, RlsContextInterceptor],
})
export class ChatModule {}
