import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Sermon } from './entities/sermon.entity';
import { CreateSermonDto } from './dto/create-sermon.dto';

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
      createdAt: r.created_at,
    };
  }
}
