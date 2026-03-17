import { Controller, Get, Post, Body, Param, Query, Delete, UseGuards } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Alias controller for /conversations endpoints
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly chatService: ChatService) {}

  // GET /conversations?userId=xxx
  @Get()
  @UseGuards(JwtAuthGuard)
  async getConversations(@Query('userId') userId: string) {
    return this.chatService.getMyConversations(userId);
  }

  // GET /conversations/:id/messages
  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async getMessages(@Param('id') conversationId: string) {
    return this.chatService.getMessages(conversationId);
  }

  // POST /conversations/start
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startConversation(@Body() body: { userId1: string; userId2: string }) {
    return this.chatService.createConversation(body.userId1, body.userId2);
  }

  // POST /conversations/group
  @Post('group')
  @UseGuards(JwtAuthGuard)
  async createGroup(@Body() body: { name: string; adminId: string; memberIds: string[] }) {
    return this.chatService.createGroup(body.name, body.adminId, body.memberIds);
  }
}
