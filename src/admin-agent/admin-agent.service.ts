import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { UsersService } from '../users/users.service';
import { ChatService } from '../chat/chat.service';
import { AnnouncementsService } from '../announcements/announcements.service';

@Injectable()
export class AdminAgentService {
  private openai: OpenAI;

  constructor(
    private usersService: UsersService,
    private chatService: ChatService,
    private announcementsService: AnnouncementsService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async processCommand(adminId: string, command: string) {
    // 1. LOOKUP: Find out who is asking (Get Real Name)
    const adminUser = await this.usersService.findOne(adminId);
    const realAuthorName = adminUser 
      ? `${adminUser.firstName} ${adminUser.lastName}` 
      : 'Admin';

    // 2. Define the Tools
    const tools = [
      {
        type: 'function',
        function: {
          name: 'create_announcement',
          description: 'Creates a public announcement.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              isPinned: { type: 'boolean' },
            },
            required: ['title', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_direct_message',
          description: 'Sends a chat message to a specific user by finding their name.',
          parameters: {
            type: 'object',
            properties: {
              targetName: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['targetName', 'message'],
          },
        },
      },
    ];

    // 3. Ask AI
    const runner = await this.openai.chat.completions.create({
      model: 'gpt-4o', // or gpt-3.5-turbo
      messages: [
        { role: 'system', content: `You are a church admin assistant acting on behalf of ${realAuthorName}.` },
        { role: 'user', content: command },
      ],
      tools: tools as any,
      tool_choice: 'auto',
    });

    const toolCall = runner.choices[0].message.tool_calls?.[0];

    if (!toolCall) {
      return { success: false, message: "I didn't understand which action to take." };
    }

    // 4. Execute Logic
    const args = JSON.parse((toolCall as any).function.arguments);
    const actionName = (toolCall as any).function.name;

    if (actionName === 'create_announcement') {
      await this.announcementsService.create({
        ...args,
        author: realAuthorName, // <--- HERE IS THE FIX (Uses real name)
        isPinned: args.isPinned || false,
      });
      return { success: true, message: `Announcement "${args.title}" created as ${realAuthorName}.` };
    }

    if (actionName === 'send_direct_message') {
      const users = await this.usersService.findAll();
      const targetUser = users.find(u => 
        u.firstName.toLowerCase().includes(args.targetName.toLowerCase()) || 
        u.lastName.toLowerCase().includes(args.targetName.toLowerCase())
      );

      if (!targetUser) return { success: false, message: `User "${args.targetName}" not found.` };

      // Create/Get chat
      const conversation = await this.chatService.createConversation(adminId, targetUser.id);
      const convId = (conversation as any).id || conversation; // Handle varying return types
      
      // Send message (This automatically uses adminId as sender, so name is correct in UI)
      await this.chatService.saveMessage(convId, adminId, args.message);

      return { success: true, message: `Message sent to ${targetUser.firstName}.` };
    }

    return { success: false, message: "Action not implemented." };
  }
}
