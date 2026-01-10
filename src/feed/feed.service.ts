import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, data: { content: string; imageUrl?: string; videoUrl?: string; location?: string; taggedUserIds?: string[] }) {
    return this.prisma.post.create({
      data: {
        userId,
        content: data.content,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        location: data.location,
        // Create the mentions links
        mentions: {
          create: data.taggedUserIds?.map(id => ({ userId: id })) || []
        }
      }
    });
  }

  // Update findAll to accept a filter
  async findAll(userId?: string) {
    return this.prisma.post.findMany({
      where: userId ? { userId } : {}, // <--- The Filter Logic
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
        mentions: { include: { user: true } },
        _count: { select: { comments: true, reactions: true } },
        reactions: true, // Include reactions so we know if WE reacted
        comments: { include: { user: true }, orderBy: { createdAt: 'asc' } } // Include comments too!
      }
    });
  }

  async findOne(postId: string) {
    return this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: true,
        mentions: { include: { user: true } },
        _count: { select: { comments: true, reactions: true } },
        reactions: true,
        comments: { include: { user: true }, orderBy: { createdAt: 'asc' } }
      }
    });
  }

  async toggleReaction(userId: string, postId: string, type: string) {
    const existing = await this.prisma.postReaction.findUnique({
      where: { userId_postId: { userId, postId } }
    });

    if (existing) {
      if (existing.type === type) {
        // If clicking same icon, remove it (toggle off)
        return this.prisma.postReaction.delete({ where: { id: existing.id } });
      } else {
        // If clicking different icon, change the type
        return this.prisma.postReaction.update({
          where: { id: existing.id },
          data: { type }
        });
      }
    } else {
      // Create new
      return this.prisma.postReaction.create({
        data: { userId, postId, type }
      });
    }
  }

  async addComment(postId: string, userId: string, content: string) {
    return this.prisma.comment.create({
      data: { postId, userId, content },
      include: { user: true }
    });
  }
}
