import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { Sermon } from './entities/sermon.entity';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SermonsService {
  constructor(private readonly audit: AuditService) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  private async actorName(userId: string): Promise<string> {
    const { queryRunner } = this.getRlsContext();
    const [r] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
    return r?.full_name ?? 'Admin';
  }

  async getSermons(filter: 'all' | 'recent' | 'series' | 'topics', limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1];

    // commentCount = comments across every post that links to this sermon
    // (posts ARE the comment surface; no sermon_comments table).
    // discussionPostCount = top-level threads — how many distinct posts
    // discuss the sermon. Lets the UI render "12 discussions, 47 comments".
    let sql = `SELECT s.*,
      (SELECT COUNT(*)::int FROM public.comments c
         JOIN public.posts p ON p.id = c.post_id
         WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS comment_count,
      (SELECT COUNT(*)::int FROM public.posts p
         WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS discussion_post_count
      FROM public.sermons s`;

    const conditions: string[] = [];

    if (filter === 'recent') {
      conditions.push(`s.created_at >= now() - interval '30 days'`);
    } else if (filter === 'series') {
      conditions.push(`s.series_name IS NOT NULL`);
    }

    if (cursor) {
      params.push(cursor);
      conditions.push(`s.id < $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    if (filter === 'series') {
      sql += ` ORDER BY s.series_name ASC, s.created_at DESC LIMIT $1`;
    } else {
      sql += ` ORDER BY s.created_at DESC LIMIT $1`;
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
      `SELECT s.*,
        (SELECT COUNT(*)::int FROM public.comments c
           JOIN public.posts p ON p.id = c.post_id
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS comment_count,
        (SELECT COUNT(*)::int FROM public.posts p
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS discussion_post_count
       FROM public.sermons s WHERE s.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Sermon not found');
    return this.mapSermon(rows[0]);
  }

  async createSermon(dto: CreateSermonDto, tenantId: string) {
    const { queryRunner, userId } = this.getRlsContext();
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
    const saved = await queryRunner.manager.save(Sermon, sermon);
    await this.audit.log({
      action: 'sermon.published',
      resourceType: 'sermon',
      resourceId: saved.id,
      summary: `${await this.actorName(userId)} published sermon "${saved.title}" by ${saved.speaker}`,
      metadata: { title: saved.title, speaker: saved.speaker, seriesName: saved.seriesName },
    });
    // Re-fetch through getSermon so the response shape includes
    // commentCount + discussionPostCount (both 0 on a freshly-created
    // sermon, but the keys must be present so the mobile doesn't read
    // `undefined`).
    return this.getSermon(saved.id);
  }

  async updateSermon(tenantId: string, id: string, dto: UpdateSermonDto) {
    const { queryRunner, userId } = this.getRlsContext();

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

    const sql = `UPDATE public.sermons SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id, title`;
    const rows = await queryRunner.query(sql, params);
    if (!rows.length) throw new NotFoundException('Sermon not found');
    await this.audit.log({
      action: 'sermon.updated',
      resourceType: 'sermon',
      resourceId: id,
      summary: `Admin updated sermon "${rows[0].title}"`,
      metadata: { changedFields: Object.keys(dto), title: rows[0].title },
    });
    // Re-fetch through getSermon so the response shape includes
    // commentCount + discussionPostCount (the RETURNING * above
    // bypassed the sub-selects so updates returned commentCount=0
    // regardless of truth).
    return this.getSermon(id);
  }

  async deleteSermon(tenantId: string, id: string) {
    const { queryRunner, userId } = this.getRlsContext();
    const [before] = await queryRunner.query(`SELECT title, speaker FROM public.sermons WHERE id = $1`, [id]);
    const rows = await queryRunner.query(
      `DELETE FROM public.sermons WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Sermon not found');
    await this.audit.log({
      action: 'sermon.deleted',
      resourceType: 'sermon',
      resourceId: id,
      summary: `${await this.actorName(userId)} deleted sermon "${before?.title ?? '(unknown)'}"`,
      metadata: { title: before?.title, speaker: before?.speaker },
    });
  }

  async getFeatured(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT s.*,
        (SELECT COUNT(*)::int FROM public.comments c
           JOIN public.posts p ON p.id = c.post_id
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS comment_count,
        (SELECT COUNT(*)::int FROM public.posts p
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS discussion_post_count
       FROM public.sermons s
       WHERE s.tenant_id = $1 AND s.is_featured = true
       ORDER BY s.created_at DESC LIMIT 1`,
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
      // Sermon discussion is rendered via posts that link to this sermon.
      // commentCount = total comments across all linked posts.
      // discussionPostCount = number of distinct discussion threads (linked posts).
      // Both default to 0 when called from surfaces that don't supply them (e.g. createSermon).
      commentCount: r.comment_count != null ? Number(r.comment_count) : 0,
      discussionPostCount: r.discussion_post_count != null ? Number(r.discussion_post_count) : 0,
      createdAt: r.created_at,
    };
  }
}
