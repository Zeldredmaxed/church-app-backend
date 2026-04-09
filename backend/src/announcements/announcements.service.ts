import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Announcement } from './entities/announcement.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementsService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getAnnouncements(filter: 'all' | 'urgent' | 'week', limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1];
    let sql = `
      SELECT a.*, u.full_name AS author_name
      FROM public.announcements a
      JOIN public.users u ON u.id = a.author_id
    `;

    const conditions: string[] = [];

    if (filter === 'urgent') {
      conditions.push(`a.priority = 'urgent'`);
    } else if (filter === 'week') {
      conditions.push(`a.created_at >= now() - interval '7 days'`);
    }

    if (cursor) {
      params.push(cursor);
      conditions.push(`a.id < $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY a.created_at DESC LIMIT $1`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      announcements: items.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        authorId: r.author_id,
        authorName: r.author_name,
        title: r.title,
        body: r.body,
        priority: r.priority,
        createdAt: r.created_at,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async createAnnouncement(dto: CreateAnnouncementDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const announcement = queryRunner.manager.create(Announcement, {
      tenantId: currentTenantId!,
      authorId: userId,
      title: dto.title,
      body: dto.body,
      priority: dto.priority ?? 'general',
    });
    return queryRunner.manager.save(Announcement, announcement);
  }
}
