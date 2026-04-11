import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [ChatController, ConversationController],
  providers: [ChatService, ConversationService, RlsContextInterceptor],
})
export class ChatModule {}
