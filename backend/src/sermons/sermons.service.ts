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

  /**
   * Aggregate sermon stats for the admin dashboard tile.
   *   totalViews        — SUM(view_count) across all sermons in the tenant
   *   avgWatchSeconds   — AVG(watch_seconds) from sermon_views if the table
   *                       exists; null when we don't yet capture per-view
   *                       watch time (no sermon_views table in current schema).
   *   sermonsThisMonth  — count created since date_trunc('month', now())
   *   seriesActive      — distinct non-empty series_name values
   */
  async getStats(tenantId: string) {
    const { queryRunner } = this.getRlsContext();

    const [[base], hasViewsTable] = await Promise.all([
      queryRunner.query(
        `SELECT
           COALESCE(SUM(view_count), 0)::int AS total_views,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS sermons_this_month,
           COUNT(DISTINCT NULLIF(series_name, ''))::int AS series_active
         FROM public.sermons WHERE tenant_id = $1`,
        [tenantId],
      ),
      queryRunner.query(
        `SELECT to_regclass('public.sermon_views') AS reg`,
      ),
    ]);

    let avgWatchSeconds: number | null = null;
    if (hasViewsTable[0]?.reg) {
      try {
        // Migration 095 ships `last_watched_seconds` — average of
        // the furthest-watched position per view. NULLIF(...,0) skips
        // bare "started but no progress recorded" rows so the average
        // isn't dragged down by zero-second pings.
        const [avgRow] = await queryRunner.query(
          `SELECT AVG(NULLIF(last_watched_seconds, 0))::float AS avg_watch
           FROM public.sermon_views WHERE tenant_id = $1`,
          [tenantId],
        );
        avgWatchSeconds = avgRow?.avg_watch != null ? Math.round(Number(avgRow.avg_watch)) : null;
      } catch {
        avgWatchSeconds = null;
      }
    }

    return {
      totalViews: base?.total_views ?? 0,
      avgWatchSeconds,
      sermonsThisMonth: base?.sermons_this_month ?? 0,
      seriesActive: base?.series_active ?? 0,
    };
  }

  /**
   * Slugify a series name into a URL-safe id. The same algorithm runs
   * in `getSeriesSermons` to map :id back to the original string for
   * the WHERE clause. Strips diacritics, lowercases, collapses
   * non-alphanumerics to single hyphens. No DB schema for series —
   * series live as a TEXT column on sermons.
   */
  private slugifySeries(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async getSeries(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    // LATERAL JOIN picks the latest sermon per series so the UI can
    // render a representative thumbnail + speaker for the series card.
    const rows = await queryRunner.query(
      `SELECT s.series_name,
              COUNT(*)::int AS count,
              latest.thumbnail_url AS latest_thumbnail_url,
              latest.speaker       AS latest_speaker,
              MAX(s.created_at)    AS most_recent_at
       FROM public.sermons s
       LEFT JOIN LATERAL (
         SELECT thumbnail_url, speaker
         FROM public.sermons
         WHERE tenant_id = s.tenant_id AND series_name = s.series_name
         ORDER BY created_at DESC LIMIT 1
       ) latest ON true
       WHERE s.tenant_id = $1 AND s.series_name IS NOT NULL AND s.series_name <> ''
       GROUP BY s.series_name, latest.thumbnail_url, latest.speaker
       ORDER BY most_recent_at DESC`,
      [tenantId],
    );
    return {
      data: rows.map((r: any) => ({
        id: this.slugifySeries(r.series_name),
        name: r.series_name,
        sermonCount: r.count,
        thumbnailUrl: r.latest_thumbnail_url ?? null,
        latestSpeaker: r.latest_speaker ?? null,
        mostRecentAt: r.most_recent_at,
      })),
    };
  }

  /**
   * Sermons within a series. The :id is the slug from getSeries; we
   * fan out to the source series_name by matching every distinct
   * series in the tenant whose slug matches. Wildcard tenant scope
   * is enforced by the WHERE.
   */
  async getSeriesSermons(tenantId: string, seriesId: string) {
    const { queryRunner } = this.getRlsContext();
    // Look up the actual series_name from the slug.
    const candidates = await queryRunner.query(
      `SELECT DISTINCT series_name FROM public.sermons
       WHERE tenant_id = $1 AND series_name IS NOT NULL AND series_name <> ''`,
      [tenantId],
    );
    const match = candidates.find((c: any) => this.slugifySeries(c.series_name) === seriesId);
    if (!match) throw new NotFoundException('Series not found');

    const rows = await queryRunner.query(
      `SELECT s.*,
        (SELECT COUNT(*)::int FROM public.comments c
           JOIN public.posts p ON p.id = c.post_id
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS comment_count,
        (SELECT COUNT(*)::int FROM public.posts p
           WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS discussion_post_count
       FROM public.sermons s
       WHERE s.tenant_id = $1 AND s.series_name = $2
       ORDER BY s.created_at DESC`,
      [tenantId, match.series_name],
    );
    return {
      seriesName: match.series_name,
      data: rows.map((r: any) => this.mapSermon(r)),
    };
  }

  /**
   * Distinct speakers ("pastors") with sermon counts, latest
   * thumbnail, and most recent sermon date. Used by the pastors
   * filter on SermonLibraryScreen.
   */
  async getPastors(tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT s.speaker AS name,
              COUNT(*)::int AS sermon_count,
              latest.thumbnail_url AS latest_thumbnail_url,
              MAX(s.created_at)    AS most_recent_at
       FROM public.sermons s
       LEFT JOIN LATERAL (
         SELECT thumbnail_url
         FROM public.sermons
         WHERE tenant_id = s.tenant_id AND speaker = s.speaker
         ORDER BY created_at DESC LIMIT 1
       ) latest ON true
       WHERE s.tenant_id = $1 AND s.speaker IS NOT NULL AND s.speaker <> ''
       GROUP BY s.speaker, latest.thumbnail_url
       ORDER BY most_recent_at DESC`,
      [tenantId],
    );
    return {
      data: rows.map((r: any) => ({
        name: r.name,
        sermonCount: r.sermon_count,
        thumbnailUrl: r.latest_thumbnail_url ?? null,
        mostRecentAt: r.most_recent_at,
      })),
    };
  }

  /**
   * Continue-watching feed: sermons the user started but didn't
   * complete, newest progress first. Caps at 20 to keep the response
   * small; mobile shows a horizontal carousel.
   */
  async getContinueWatching(tenantId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT s.*,
              v.last_watched_seconds, v.updated_at AS view_updated_at,
              (SELECT COUNT(*)::int FROM public.comments c
                 JOIN public.posts p ON p.id = c.post_id
                 WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS comment_count,
              (SELECT COUNT(*)::int FROM public.posts p
                 WHERE p.linked_sermon_id = s.id AND p.tenant_id = s.tenant_id) AS discussion_post_count
       FROM public.sermon_views v
       JOIN public.sermons s ON s.id = v.sermon_id
       WHERE v.user_id = $1 AND v.tenant_id = $2 AND v.completed_at IS NULL
         AND v.last_watched_seconds > 0
       ORDER BY v.updated_at DESC
       LIMIT 20`,
      [userId, tenantId],
    );
    return {
      data: rows.map((r: any) => ({
        ...this.mapSermon(r),
        lastWatchedSeconds: r.last_watched_seconds,
        viewUpdatedAt: r.view_updated_at,
      })),
    };
  }

  /**
   * Records / updates the caller's progress on a sermon. Idempotent
   * via UPSERT on (user_id, sermon_id). last_watched_seconds is
   * monotonically increasing — a stale ping with a lower value
   * doesn't roll the position back (GREATEST guard). completed=true
   * snaps the completed_at timestamp.
   */
  async upsertView(
    tenantId: string,
    userId: string,
    sermonId: string,
    lastWatchedSeconds: number,
    completed?: boolean,
  ) {
    const { queryRunner } = this.getRlsContext();
    // Verify sermon belongs to the tenant — without this, a user could
    // bump someone else's church's view count by guessing sermon ids.
    const sermon = await queryRunner.query(
      `SELECT id FROM public.sermons WHERE id = $1 AND tenant_id = $2`,
      [sermonId, tenantId],
    );
    if (sermon.length === 0) throw new NotFoundException('Sermon not found');

    await queryRunner.query(
      `INSERT INTO public.sermon_views
         (user_id, sermon_id, tenant_id, last_watched_seconds, completed_at, updated_at)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5 = true THEN now() ELSE NULL END,
               now())
       ON CONFLICT (user_id, sermon_id) DO UPDATE SET
         last_watched_seconds = GREATEST(sermon_views.last_watched_seconds, EXCLUDED.last_watched_seconds),
         completed_at = COALESCE(sermon_views.completed_at,
                                  CASE WHEN $5 = true THEN now() ELSE NULL END),
         updated_at = now()`,
      [userId, sermonId, tenantId, lastWatchedSeconds, completed ?? false],
    );
    return { recorded: true };
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
