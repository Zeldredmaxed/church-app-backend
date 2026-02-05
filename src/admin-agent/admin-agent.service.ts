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
      const searchName = args.targetName.toLowerCase().trim();

      // 1. Find ALL matches (not just the first one)
      const matchingUsers = users.filter(u => {
        const first = u.firstName.toLowerCase();
        const last = u.lastName.toLowerCase();
        const full = `${first} ${last}`;
        
        return first.includes(searchName) || 
               last.includes(searchName) || 
               full.includes(searchName);
      });

      // 2. Handle the results
      if (matchingUsers.length === 0) {
        return { success: false, message: `Could not find any user matching "${args.targetName}".` };
      }

      if (matchingUsers.length > 1) {
        // Create a list of names to show the admin
        const names = matchingUsers.map(u => `${u.firstName} ${u.lastName}`).join(', ');
        return { 
          success: false, 
          message: `I found ${matchingUsers.length} people matching that name: ${names}. Please type the full name.` 
        };
      }

      // 3. Exact Match Found (Length is 1)
      const targetUser = matchingUsers[0];

      // Create/Get chat (Now guarantees participants exist)
      const conversation = await this.chatService.createConversation(adminId, targetUser.id);
      
      // Send message
      // Note: We use conversation.id directly now, because our new function always returns the full object
      await this.chatService.saveMessage(conversation.id, adminId, args.message);

      return { success: true, message: `Message sent to ${targetUser.firstName} ${targetUser.lastName}.` };
    }

    return { success: false, message: "Action not implemented." };
  }
}
