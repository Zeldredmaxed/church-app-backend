import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Save a message
  async saveMessage(conversationId: string, userId: string, content: string) {
    return this.prisma.message.create({
      data: { conversationId, senderId: userId, content },
      include: { sender: true }
    });
  }
  
  // 2. Create 1-on-1 Chat
  async createConversation(userId1: string, userId2: string) {
    const participants = [userId1, userId2].sort();
    return this.prisma.conversation.create({
      data: {
        id: `conv_${participants[0]}_${participants[1]}`,
        isGroup: false,
        participants: {
          connectOrCreate: [
            { where: { id: `p_${userId1}_${participants[0]}_${participants[1]}` }, create: { userId: userId1 } }, 
             // Note: In a real app we'd do this cleaner, but this prevents errors for now
          ]
        }
      }
    }).catch(e => { 
        // If it exists, we just return the ID conceptually, or fetch it
        return { id: `conv_${participants[0]}_${participants[1]}` };
    });
  }

  // 3. Create GROUP Chat
  async createGroup(name: string, adminId: string, memberIds: string[], isLocked: boolean = false) {
    return this.prisma.conversation.create({
      data: {
        isGroup: true,
        name: name,
        participants: {
          create: [
            { userId: adminId },
            ...memberIds.map(id => ({ userId: id }))
          ]
        }
      }
    });
  }

  // 4. Get My Conversations
  async getMyConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        participants: { some: { userId } }
      },
      include: {
        participants: { include: { user: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // 5. Search Users
  async searchUsers(query: string) {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true }
    });
  }

  // 6. Add Participant (THIS WAS MISSING)
  async addParticipant(conversationId: string, userId: string) {
    // Check if they are already in it
    const existing = await this.prisma.participant.findFirst({
      where: { conversationId, userId }
    });
    
    if (existing) return existing;

    return this.prisma.participant.create({
      data: {
        conversationId,
        userId
      }
    });
  }

  // 7. Get Message History
async getMessages(conversationId: string) {
  return this.prisma.message.findMany({
    where: { conversationId },
    include: { sender: true },
    orderBy: { createdAt: 'asc' } // Oldest first
  });
}

  // ADMIN: Get ALL Group Chats (for moderation)
  async getAllGroups() {
    return this.prisma.conversation.findMany({
      where: { isGroup: true },
      include: {
        messages: { take: 1, orderBy: { createdAt: 'desc' } }, // Preview last message
        participants: { include: { user: true } } // See who is in it
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // ADMIN: Delete a Message
  async deleteMessage(messageId: string) {
    return this.prisma.message.delete({ where: { id: messageId } });
  }

  // 8. Create or Sync a Group based on a Tag
  async syncTagGroup(tagId: string, adminId: string) {
    // A. Fetch the Tag info and all Users who have it
    const tag = await this.prisma.tag.findUnique({
      where: { id: tagId },
      include: { users: true } // This gives us the UserTags
    });

    if (!tag) throw new Error("Tag not found");

    // B. Find existing group or Create new one
    let conversation = await this.prisma.conversation.findUnique({
      where: { tagId: tagId }
    });

    if (!conversation) {
      // Create new
      conversation = await this.prisma.conversation.create({
        data: {
          name: `${tag.name} Official`, // e.g. "Praise Team Official"
          isGroup: true,
          tagId: tagId,
          participants: {
            create: { userId: adminId } // Start with Admin
          }
        }
      });
    }

    // C. The Sync: Add all users who have the tag but aren't in the chat yet
    // Get list of user IDs from the tag
    const tagUserIds = tag.users.map(ut => ut.userId);

    // Loop and add them (ignoring duplicates)
    for (const userId of tagUserIds) {
      await this.prisma.participant.create({
        data: { conversationId: conversation.id, userId }
      }).catch(() => {}); // Catch error if they already exist (Unique constraint handles this)
    }

    return conversation;
  }
}