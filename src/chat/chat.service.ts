import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 1. Save a message (Updated with Notification)
  async saveMessage(conversationId: string, senderId: string, content: string) {
    // A. Save to DB
    const message = await this.prisma.message.create({
      data: { conversationId, senderId, content },
      include: { sender: true },
    });

    // B. NOTIFY RECIPIENTS (The Fix)
    // Find who else is in this conversation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (conversation) {
      for (const p of conversation.participants) {
        // Don't notify the sender (the AI or Admin)
        if (p.userId !== senderId) {
          this.notificationsService.send(
            p.userId,
            'chat',
            `New Message from ${message.sender.firstName}`,
            content,
          );
        }
      }
    }

    return message;
  }
  
  // 2. Create or Get 1-on-1 Chat (Bulletproof Version)
  async createConversation(userId1: string, userId2: string) {
    // Sort IDs to ensure A+B is the same as B+A
    const sorted = [userId1, userId2].sort();
    const conversationId = `conv_${sorted[0]}_${sorted[1]}`;

    // A. Check if it exists
    let conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    // B. If not, create it with both participants
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          id: conversationId,
          isGroup: false,
          participants: {
            create: [
              { userId: userId1 },
              { userId: userId2 },
            ],
          },
        },
        include: { participants: true },
      });
    }

    // C. SAFETY CHECK: Ensure both users are actually in the participant list
    // (This fixes the bug where a chat exists but the user isn't linked)
    const p1Exists = conversation.participants.some(p => p.userId === userId1);
    const p2Exists = conversation.participants.some(p => p.userId === userId2);

    if (!p1Exists) {
      await this.prisma.participant.create({ data: { conversationId, userId: userId1 } });
    }
    if (!p2Exists) {
      await this.prisma.participant.create({ data: { conversationId, userId: userId2 } });
    }

    return conversation;
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