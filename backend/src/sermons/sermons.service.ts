import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Sermon } from './entities/sermon.entity';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';

@Injectable()
export class SermonsService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getSermons(filter: 'all' | 'recent' | 'series' | 'topics', limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1];
    let sql = `SELECT * FROM public.sermons`;

    const conditions: string[] = [];

    if (filter === 'recent') {
      conditions.push(`created_at >= now() - interval '30 days'`);
    } else if (filter === 'series') {
      conditions.push(`series_name IS NOT NULL`);
    }

    if (cursor) {
      params.push(cursor);
      conditions.push(`id < $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    if (filter === 'series') {
      sql += ` ORDER BY series_name ASC, created_at DESC LIMIT $1`;
    } else {
      sql += ` ORDER BY created_at DESC LIMIT $1`;
    }

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      sermons: items.map((r: any) => this.mapSermon(r)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getSermon(id: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT * FROM public.sermons WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Sermon not found');
    return this.mapSermon(rows[0]);
  }

  async createSermon(dto: CreateSermonDto, tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const sermon = queryRunner.manager.create(Sermon, {
      tenantId,
      title: dto.title,
      speaker: dto.speaker,
      audioUrl: dto.audioUrl ?? null,
      videoUrl: dto.videoUrl ?? null,
      thumbnailUrl: dto.thumbnailUrl ?? null,
      duration: dto.duration ?? null,
      seriesName: dto.seriesName ?? null,
      notes: dto.notes ?? null,
    });
    return queryRunner.manager.save(Sermon, sermon);
  }

  async updateSermon(tenantId: string, id: string, dto: UpdateSermonDto) {
    const { queryRunner } = this.getRlsContext();

    const setClauses: string[] = [];
    const params: any[] = [id, tenantId];

    const columnMap: Record<string, string> = {
      title: 'title',
      speaker: 'speaker',
      audioUrl: 'audio_url',
      videoUrl: 'video_url',
      thumbnailUrl: 'thumbnail_url',
      duration: 'duration',
      seriesName: 'series_name',
      notes: 'notes',
      isFeatured: 'is_featured',
      transcript: 'transcript',
    };

    for (const [key, col] of Object.entries(columnMap)) {
      if ((dto as any)[key] !== undefined) {
        params.push((dto as any)[key]);
        setClauses.push(`${col} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) {
      return this.getSermon(id);
    }

    const sql = `UPDATE public.sermons SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`;
    const rows = await queryRunner.query(sql, params);
    if (!rows.length) throw new NotFoundException('Sermon not found');
    return this.mapSermon(rows[0]);
  }

  async deleteSermon(tenantId: string, id: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `DELETE FROM public.sermons WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Sermon not found');
  }

  async getFeatured(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT * FROM public.sermons WHERE tenant_id = $1 AND is_featured = true ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (!rows.length) return null;
    return this.mapSermon(rows[0]);
  }

  async getSeries(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT DISTINCT series_name, COUNT(*)::int as count FROM public.sermons WHERE tenant_id = $1 AND series_name IS NOT NULL GROUP BY series_name ORDER BY series_name`,
      [tenantId],
    );
    return rows.map((r: any) => ({ seriesName: r.series_name, count: r.count }));
  }

  async getEngagement(tenantId: string, id: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT view_count, like_count FROM public.sermons WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Sermon not found');
    return { viewCount: rows[0].view_count, likeCount: rows[0].like_count };
  }

  async likeSermon(tenantId: string, sermonId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    // Verify sermon belongs to tenant
    const sermon = await queryRunner.query(
      `SELECT id FROM public.sermons WHERE id = $1 AND tenant_id = $2`,
      [sermonId, tenantId],
    );
    if (!sermon.length) throw new NotFoundException('Sermon not found');

    await queryRunner.query(
      `INSERT INTO public.sermon_likes (sermon_id, user_id) VALUES ($1, $2) ON CONFLICT (sermon_id, user_id) DO NOTHING`,
      [sermonId, userId],
    );
    await queryRunner.query(
      `UPDATE public.sermons SET like_count = (SELECT COUNT(*)::int FROM public.sermon_likes WHERE sermon_id = $1) WHERE id = $1`,
      [sermonId],
    );
  }

  async recordView(tenantId: string, sermonId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `UPDATE public.sermons SET view_count = view_count + 1 WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [sermonId, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Sermon not found');
  }

  private mapSermon(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      speaker: r.speaker,
      audioUrl: r.audio_url,
      videoUrl: r.video_url,
      thumbnailUrl: r.thumbnail_url,
      duration: r.duration,
      seriesName: r.series_name,
      notes: r.notes,
      isFeatured: r.is_featured,
      transcript: r.transcript,
      viewCount: r.view_count,
      likeCount: r.like_count,
      createdAt: r.created_at,
    };
  }
}
