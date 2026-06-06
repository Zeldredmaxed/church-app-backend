import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import {
  AdminChatController,
  AdminChatModerationController,
  ChatMessageFlagController,
} from './admin-chat.controller';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    AuditModule,
  ],
  controllers: [
    ChatController,
    ConversationController,
    AdminChatController,
    AdminChatModerationController,
    ChatMessageFlagController,
  ],
  providers: [ChatService, ConversationService, RlsContextInterceptor],
})
export class ChatModule {}
