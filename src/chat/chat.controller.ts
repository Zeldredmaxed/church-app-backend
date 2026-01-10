import { Controller, Post, Get, Body, Query, Param, Delete } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // 1. Start 1-on-1 Chat
  @Post('start')
  async startConversation(@Body() body: { userId1: string; userId2: string }) {
    return this.chatService.createConversation(body.userId1, body.userId2);
  }

  // 2. Create Group
  @Post('group')
  async createGroup(@Body() body: { name: string; adminId: string; memberIds: string[]; isLocked?: boolean }) {
    return this.chatService.createGroup(body.name, body.adminId, body.memberIds, body.isLocked);
  }

  // POST /chat/tag-group
  @Post('tag-group')
  async syncTagGroup(@Body() body: { tagId: string; adminId: string }) {
    return this.chatService.syncTagGroup(body.tagId, body.adminId);
  }

  // 3. Get My Chats
  @Get('my-chats/:userId')
  async getMyChats(@Param('userId') userId: string) {
    return this.chatService.getMyConversations(userId);
  }

  // 4. Search Directory
  @Get('users')
  async searchUsers(@Query('q') q: string) {
    return this.chatService.searchUsers(q || '');
  }

  // 5. Add Participant (THIS WAS MISSING!)
  @Post(':id/participants')
  async addParticipant(@Param('id') conversationId: string, @Body() body: { userId: string }) {
    return this.chatService.addParticipant(conversationId, body.userId);
  }

  // 6. Get Messages
@Get(':id/messages')
async getMessages(@Param('id') conversationId: string) {
  return this.chatService.getMessages(conversationId);
}

  // ADMIN: Send Message via REST (for Web Dashboard)
  @Post(':id/messages')
  async sendMessage(@Param('id') conversationId: string, @Body() body: { userId: string; content: string }) {
    // 1. Save to DB
    const message = await this.chatService.saveMessage(conversationId, body.userId, body.content);
    
    // Note: In a perfect world, we would also emit a Socket event here so mobile users see it instantly.
    // For now, this saves it to history, so they will see it next time they open the chat.
    return message;
  }

  // ADMIN: Get All Groups
  @Get('admin/groups')
  async getAllGroups() {
    return this.chatService.getAllGroups();
  }

  // ADMIN: Delete Message
  @Delete('messages/:id')
  async deleteMessage(@Param('id') id: string) {
    return this.chatService.deleteMessage(id);
  }
}