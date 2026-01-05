import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async saveMessage(conversationId: string, userId: string, content: string) {
    return this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        content,
      },
      include: { sender: true } // Return the sender's info (name/avatar) too
    });
  }
  
  // Create a simple 1-on-1 chat
  async createConversation(userId1: string, userId2: string) {
    return this.prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId: userId1 },
            { userId: userId2 }
          ]
        }
      }
    });
  }
}