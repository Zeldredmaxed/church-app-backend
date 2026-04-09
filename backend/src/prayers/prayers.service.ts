import { Injectable, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Prayer } from './entities/prayer.entity';
import { CreatePrayerDto } from './dto/create-prayer.dto';

@Injectable()
export class PrayersService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getPrayers(filter: 'all' | 'mine' | 'answered', userId: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1, userId];
    const conditions: string[] = [];

    if (filter === 'mine') {
      conditions.push(`p.author_id = $2`);
    } else if (filter === 'answered') {
      conditions.push(`p.is_answered = true`);
    }

    if (cursor) {
      params.push(cursor);
      conditions.push(`p.created_at < (SELECT created_at FROM public.prayers WHERE id = $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT p.*,
        u.id AS author_user_id,
        u.full_name AS author_full_name,
        u.avatar_url AS author_avatar_url,
        (SELECT COUNT(*)::int FROM public.prayer_prays WHERE prayer_id = p.id) AS praying_count,
        EXISTS(SELECT 1 FROM public.prayer_prays WHERE prayer_id = p.id AND user_id = $2) AS is_prayed_by_me
      FROM public.prayers p
      LEFT JOIN public.users u ON u.id = p.author_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $1
    `;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const prayers = hasMore ? rows.slice(0, limit) : rows;

    return {
      prayers: prayers.map((r: any) => this.mapPrayer(r)),
      nextCursor: hasMore ? prayers[prayers.length - 1].id : null,
    };
  }

  async createPrayer(dto: CreatePrayerDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    const prayer = queryRunner.manager.create(Prayer, {
      tenantId: currentTenantId!,
      authorId: userId,
      content: dto.content,
      isAnonymous: dto.isAnonymous ?? false,
    });
    const saved = await queryRunner.manager.save(Prayer, prayer);
    return saved;
  }

  async togglePray(prayerId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    // Verify prayer exists
    const rows = await queryRunner.query(
      `SELECT id FROM public.prayers WHERE id = $1`,
      [prayerId],
    );
    if (!rows.length) throw new NotFoundException('Prayer not found');

    // Toggle: INSERT on conflict DELETE
    const existing = await queryRunner.query(
      `SELECT 1 FROM public.prayer_prays WHERE prayer_id = $1 AND user_id = $2`,
      [prayerId, userId],
    );

    if (existing.length > 0) {
      await queryRunner.query(
        `DELETE FROM public.prayer_prays WHERE prayer_id = $1 AND user_id = $2`,
        [prayerId, userId],
      );
      return { praying: false };
    } else {
      await queryRunner.query(
        `INSERT INTO public.prayer_prays (prayer_id, user_id) VALUES ($1, $2)
         ON CONFLICT (prayer_id, user_id) DO NOTHING`,
        [prayerId, userId],
      );
      return { praying: true };
    }
  }

  async markAnswered(prayerId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT author_id FROM public.prayers WHERE id = $1`,
      [prayerId],
    );
    if (!rows.length) throw new NotFoundException('Prayer not found');
    if (rows[0].author_id !== userId) {
      throw new ForbiddenException('Only the author can mark a prayer as answered');
    }

    await queryRunner.manager.update(Prayer, { id: prayerId }, { isAnswered: true });
    return { isAnswered: true };
  }

  async deletePrayer(prayerId: string, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT p.author_id FROM public.prayers p WHERE p.id = $1`,
      [prayerId],
    );
    if (!rows.length) throw new NotFoundException('Prayer not found');

    const isAuthor = rows[0].author_id === userId;

    if (!isAuthor) {
      // Check if user is an admin in the current tenant
      const memberRows = await queryRunner.query(
        `SELECT role FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2`,
        [currentTenantId, userId],
      );
      if (!memberRows.length || memberRows[0].role !== 'admin') {
        throw new ForbiddenException('Only the author or an admin can delete a prayer');
      }
    }

    await queryRunner.manager.delete(Prayer, { id: prayerId });
  }

  private mapPrayer(r: any) {
    const isAnonymous = r.is_anonymous;
    return {
      id: r.id,
      authorId: r.author_id,
      author: isAnonymous
        ? null
        : {
            id: r.author_user_id,
            fullName: r.author_full_name,
            avatarUrl: r.author_avatar_url,
          },
      content: r.content,
      isAnonymous,
      isAnswered: r.is_answered,
      prayingCount: Number(r.praying_count ?? 0),
      isPrayedByMe: r.is_prayed_by_me === true || r.is_prayed_by_me === 't',
      createdAt: r.created_at,
    };
  }
}
