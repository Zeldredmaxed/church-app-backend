import { Controller, Post, Get, Body, Query, Param, Delete, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // 1. Start 1-on-1 Chat
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startConversation(@Body() body: { userId1: string; userId2: string }) {
    return this.chatService.createConversation(body.userId1, body.userId2);
  }

  // 2. Create Group
  @Post('group')
  @UseGuards(JwtAuthGuard)
  async createGroup(@Body() body: { name: string; adminId: string; memberIds: string[]; isLocked?: boolean }) {
    return this.chatService.createGroup(body.name, body.adminId, body.memberIds, body.isLocked);
  }

  // POST /chat/tag-group
  @Post('tag-group')
  @UseGuards(JwtAuthGuard)
  async syncTagGroup(@Body() body: { tagId: string; adminId: string }) {
    return this.chatService.syncTagGroup(body.tagId, body.adminId);
  }

  // 3. Get My Chats
  @Get('my-chats/:userId')
  @UseGuards(JwtAuthGuard)
  async getMyChats(@Param('userId') userId: string) {
    return this.chatService.getMyConversations(userId);
  }

  // 4. Search Directory / User Directory
  // GET /chat/users?q=searchTerm&excludeMe=userId
  // If q is empty, returns ALL users (full directory).
  // Pass excludeMe to hide the current user from results.
  @Get('users')
  @UseGuards(JwtAuthGuard)
  async searchUsers(
    @Query('q') q: string,
    @Query('excludeMe') excludeMe: string,
  ) {
    return this.chatService.searchUsers(q || '', excludeMe || undefined);
  }

  // 5. Add Participant (THIS WAS MISSING!)
  @Post(':id/participants')
  @UseGuards(JwtAuthGuard)
  async addParticipant(@Param('id') conversationId: string, @Body() body: { userId: string }) {
    return this.chatService.addParticipant(conversationId, body.userId);
  }

  // 6. Get Messages
  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async getMessages(@Param('id') conversationId: string) {
    return this.chatService.getMessages(conversationId);
  }

  // ADMIN: Send Message via REST (for Web Dashboard)
  @Post(':id/messages')
  @UseGuards(JwtAuthGuard)
  async sendMessage(@Param('id') conversationId: string, @Body() body: { userId: string; content: string }) {
    // 1. Save to DB
    const message = await this.chatService.saveMessage(conversationId, body.userId, body.content);
    
    // Note: In a perfect world, we would also emit a Socket event here so mobile users see it instantly.
    // For now, this saves it to history, so they will see it next time they open the chat.
    return message;
  }

  // ADMIN: Get All Groups
  @Get('admin/groups')
  @UseGuards(JwtAuthGuard)
  async getAllGroups() {
    return this.chatService.getAllGroups();
  }

  // ADMIN: Delete Message
  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard)
  async deleteMessage(@Param('id') id: string) {
    return this.chatService.deleteMessage(id);
  }
}