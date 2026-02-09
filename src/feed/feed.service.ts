import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule'; // <--- New Import
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class FeedService {
  // Initialize Supabase for file deletion
  private supabase = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '');

  constructor(private readonly prisma: PrismaService) {}

  // --- THE JANITOR (Runs every night at midnight) ---
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    console.log('[JANITOR] Checking for dead posts...');
    
    // 1. Calculate the cutoff date (60 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 60);

    // 2. Find posts to delete
    const deadPosts = await this.prisma.post.findMany({
      where: { lastInteractionAt: { lt: cutoffDate } }
    });

    console.log(`[JANITOR] Found ${deadPosts.length} posts to delete.`);

    for (const post of deadPosts) {
      // A. Delete files from Supabase (Video/Image)
      if (post.imageUrl && post.imageUrl.includes('supabase')) {
        const path = post.imageUrl.split('/uploads/').pop();
        if (path) await this.supabase.storage.from('uploads').remove([path]);
      }
      if (post.videoUrl && post.videoUrl.includes('supabase')) {
        const path = post.videoUrl.split('/uploads/').pop();
        if (path) await this.supabase.storage.from('uploads').remove([path]);
      }

      // B. Delete from DB
      await this.prisma.post.delete({ where: { id: post.id } });
    }
  }

  // --- INTERACTION HELPER (Bumps the timer) ---
  async bumpPost(postId: string) {
    await this.prisma.post.update({
      where: { id: postId },
      data: { lastInteractionAt: new Date() } // Reset the clock to NOW
    }).catch(e => console.log("Post already deleted"));
  }

  // --- EXISTING METHODS (Updated to call bumpPost) ---

  async create(userId: string, data: any) {
    return this.prisma.post.create({
      data: {
        userId,
        content: data.content,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        location: data.location,
        lastInteractionAt: new Date(), // Set initial time
        mentions: { create: data.taggedUserIds?.map(id => ({ userId: id })) || [] }
      }
    });
  }

  async findAll(userId?: string) {
    return this.prisma.post.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
        mentions: { include: { user: true } },
        _count: { select: { comments: true, reactions: true } },
        reactions: true,
        comments: { include: { user: true }, orderBy: { createdAt: 'asc' } }
      }
    });
  }

  // 3. Find One Post (The Missing Piece)
  async findOne(id: string) {
    return this.prisma.post.findUnique({
      where: { id },
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
    // 1. Bump the post!
    await this.bumpPost(postId);

    const existing = await this.prisma.postReaction.findUnique({
      where: { userId_postId: { userId, postId } }
    });

    if (existing) {
      if (existing.type === type) return this.prisma.postReaction.delete({ where: { id: existing.id } });
      return this.prisma.postReaction.update({ where: { id: existing.id }, data: { type } });
    }
    return this.prisma.postReaction.create({ data: { userId, postId, type } });
  }

  async addComment(postId: string, userId: string, content: string) {
    // 1. Bump the post!
    await this.bumpPost(postId);

    return this.prisma.comment.create({
      data: { postId, userId, content },
      include: { user: true }
    });
  }
}
