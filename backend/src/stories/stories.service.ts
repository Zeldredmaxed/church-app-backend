import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Story } from './entities/story.entity';
import { CreateStoryDto } from './dto/create-story.dto';

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  private mapStory(row: any) {
    return {
      id: row.id,
      authorId: row.author_id,
      author: {
        id: row.author_id,
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
      },
      mediaUrl: row.media_url,
      mediaType: row.media_type ?? null,
      text: row.text,
      backgroundColor: row.background_color,
      viewCount: Number(row.view_count ?? 0),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async getFeed(userId: string) {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT s.id, s.author_id, s.media_url, s.media_type, s.text, s.background_color,
              s.created_at, s.expires_at,
              u.full_name, u.avatar_url,
              (SELECT COUNT(*)::int FROM public.story_views WHERE story_id = s.id) AS view_count,
              EXISTS(SELECT 1 FROM public.story_views WHERE story_id = s.id AND viewer_id = $1) AS is_viewed_by_me
       FROM public.stories s
       JOIN public.users u ON u.id = s.author_id
       WHERE s.expires_at > now()
       ORDER BY s.created_at ASC`,
      [userId],
    );

    // Group by author
    const groupMap = new Map<string, any>();
    for (const row of rows) {
      const authorId = row.author_id;
      if (!groupMap.has(authorId)) {
        groupMap.set(authorId, {
          userId: authorId,
          fullName: row.full_name,
          avatarUrl: row.avatar_url,
          stories: [],
          hasUnviewed: false,
          latestAt: row.created_at,
        });
      }
      const group = groupMap.get(authorId);
      group.stories.push(this.mapStory(row));
      if (!row.is_viewed_by_me) group.hasUnviewed = true;
      if (new Date(row.created_at) > new Date(group.latestAt)) {
        group.latestAt = row.created_at;
      }
    }

    const groups = Array.from(groupMap.values());

    // Sort: current user first, then by latestAt DESC
    groups.sort((a, b) => {
      if (a.userId === userId) return -1;
      if (b.userId === userId) return 1;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });

    return { stories: groups };
  }

  async createStory(dto: CreateStoryDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    const story = queryRunner.manager.create(Story, {
      authorId: userId,
      tenantId: currentTenantId!,
      mediaUrl: dto.mediaUrl ?? null,
      mediaType: dto.mediaType ?? null,
      text: dto.text ?? null,
      backgroundColor: dto.backgroundColor ?? null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const saved = await queryRunner.manager.save(Story, story);

    // Re-fetch with author info
    const rows = await queryRunner.query(
      `SELECT s.id, s.author_id, s.media_url, s.media_type, s.text, s.background_color,
              s.created_at, s.expires_at,
              u.full_name, u.avatar_url,
              0 AS view_count
       FROM public.stories s
       JOIN public.users u ON u.id = s.author_id
       WHERE s.id = $1`,
      [saved.id],
    );

    return this.mapStory(rows[0]);
  }

  async getMyStories(userId: string) {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT s.id, s.author_id, s.media_url, s.media_type, s.text, s.background_color,
              s.created_at, s.expires_at,
              u.full_name, u.avatar_url,
              (SELECT COUNT(*)::int FROM public.story_views WHERE story_id = s.id) AS view_count
       FROM public.stories s
       JOIN public.users u ON u.id = s.author_id
       WHERE s.author_id = $1 AND s.expires_at > now()
       ORDER BY s.created_at DESC`,
      [userId],
    );

    return rows.map((r: any) => this.mapStory(r));
  }

  async deleteStory(storyId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    const result = await queryRunner.query(
      `DELETE FROM public.stories WHERE id = $1`,
      [storyId],
    );

    // result is [rows, affectedCount] in pg driver via TypeORM
    const affected = Array.isArray(result) ? result[1] : result?.rowCount ?? 0;
    if (affected === 0) throw new NotFoundException('Story not found');
  }

  async viewStory(storyId: string, viewerId: string) {
    const { queryRunner } = this.getRlsContext();

    try {
      await queryRunner.query(
        `INSERT INTO public.story_views (story_id, viewer_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [storyId, viewerId],
      );
    } catch (err) {
      this.logger.warn(`Failed to record story view: ${err}`);
    }
  }
}
