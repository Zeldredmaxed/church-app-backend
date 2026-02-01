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
    // 1. Define the Tools the AI can use
    const tools = [
      {
        type: 'function',
        function: {
          name: 'create_announcement',
          description: 'Creates a public announcement for the church board.',
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
              targetName: { type: 'string', description: 'The first or last name of the person' },
              message: { type: 'string' },
            },
            required: ['targetName', 'message'],
          },
        },
      },
    ];

    // 2. Ask AI to plan the action
    const runner = await this.openai.chat.completions.create({
      model: 'gpt-4o', // Smartest model for logic
      messages: [
        { role: 'system', content: 'You are a church admin assistant. Execute the user\'s request using the available tools.' },
        { role: 'user', content: command },
      ],
      tools: tools as any,
      tool_choice: 'auto',
    });

    const toolCall = runner.choices[0].message.tool_calls?.[0];

    if (!toolCall) {
      return { success: false, message: "I didn't understand which action to take." };
    }

    // 3. Execute the specific tool
    const args = JSON.parse((toolCall as any).function.arguments);
    const actionName = (toolCall as any).function.name;

    if (actionName === 'create_announcement') {
      await this.announcementsService.create({
        ...args,
        author: 'Pastor (AI)',
        isPinned: args.isPinned || false,
      });
      return { success: true, message: `Announcement "${args.title}" created.` };
    }

    if (actionName === 'send_direct_message') {
      // Step A: Find the user ID based on the name
      const users = await this.usersService.findAll(); // In a real app, use a search query for efficiency
      const targetUser = users.find(u => 
        u.firstName.toLowerCase().includes(args.targetName.toLowerCase()) || 
        u.lastName.toLowerCase().includes(args.targetName.toLowerCase())
      );

      if (!targetUser) {
        return { success: false, message: `Could not find a user named "${args.targetName}".` };
      }

      // Step B: Create/Find Conversation
      const conversation = await this.chatService.createConversation(adminId, targetUser.id);
      
      // Step C: Send Message
      // Check if conversation returned an ID or object (based on previous code structure)
      const convId = (conversation as any).id || conversation; 
      await this.chatService.saveMessage(convId, adminId, args.message);

      return { success: true, message: `Message sent to ${targetUser.firstName}.` };
    }

    return { success: false, message: "Action not implemented yet." };
  }
}
