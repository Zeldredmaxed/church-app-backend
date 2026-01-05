import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Endpoint to start a new conversation
  // POST /chat/start
  @Post('start')
  async startConversation(@Body() body: { userId1: string; userId2: string }) {
    return this.chatService.createConversation(body.userId1, body.userId2);
  }
}