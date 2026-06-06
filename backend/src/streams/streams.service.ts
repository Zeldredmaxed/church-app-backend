import { Injectable, InternalServerErrorException, NotFoundException, Logger } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { MuxService } from '../media/mux.service';
import { AuditService } from '../audit/audit.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';

export interface PublicStream {
  id: string;
  tenantId: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  isLive: boolean;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  viewerCount: number;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Explicit allow-list — NEVER selects mux_stream_key so the RTMP secret
 * can't accidentally leak through SELECT * / RETURNING *. Used by every
 * read path. POST /api/streams uses a SEPARATE explicit list to return
 * the stream_key once for the OBS paste-in.
 */
const PUBLIC_STREAM_COLS = `id, tenant_id, title, starts_at, ends_at, is_live,
  mux_live_stream_id, mux_playback_id, thumbnail_url, viewer_count,
  created_by, created_at, updated_at`;

function toPublicStream(row: any): PublicStream {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isLive: row.is_live,
    muxPlaybackId: row.mux_playback_id,
    thumbnailUrl: row.thumbnail_url,
    viewerCount: row.viewer_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);

  constructor(
    private readonly mux: MuxService,
    private readonly audit: AuditService,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getCurrent(): Promise<PublicStream | null> {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT ${PUBLIC_STREAM_COLS} FROM public.streams
       WHERE is_live = true
       ORDER BY starts_at DESC
       LIMIT 1`,
    );
    return rows.length > 0 ? toPublicStream(rows[0]) : null;
  }

  async list(limit: number): Promise<{ data: PublicStream[] }> {
    const { queryRunner } = this.getRlsContext();
    const rows = await queryRunner.query(
      `SELECT ${PUBLIC_STREAM_COLS} FROM public.streams
       ORDER BY starts_at DESC
       LIMIT $1`,
      [limit],
    );
    return { data: rows.map(toPublicStream) };
  }

  /**
   * POST /api/streams. Creates DB row + provisions Mux Live Stream.
   * Returns the stream_key ONCE (for OBS paste-in).
   *
   * Mux provision happens FIRST so we know the stream_key value at INSERT
   * time. If the INSERT then fails (e.g. RLS violation, network), we
   * compensate by deleting the Mux stream — without this an orphan
   * billed Mux stream would float forever. The compensating delete is
   * best-effort; we log and re-throw the original error so the admin
   * sees the real failure.
   */
  async create(
    dto: CreateStreamDto,
    userId: string,
  ): Promise<PublicStream & { streamKey: string }> {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) {
      throw new InternalServerErrorException('No tenant in RLS context');
    }

    const { liveStreamId, streamKey, playbackId } = await this.mux.createLiveStream();

    let row: any;
    try {
      const result = await queryRunner.query(
        `INSERT INTO public.streams
           (tenant_id, title, starts_at, ends_at, thumbnail_url,
            mux_live_stream_id, mux_playback_id, mux_stream_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${PUBLIC_STREAM_COLS}`,
        [
          currentTenantId,
          dto.title,
          dto.startsAt,
          dto.endsAt ?? null,
          dto.thumbnailUrl ?? null,
          liveStreamId,
          playbackId,
          streamKey,
          userId,
        ],
      );
      row = result[0];
    } catch (e: any) {
      this.logger.error(
        `INSERT public.streams failed after Mux provision — compensating delete of ${liveStreamId}: ${e.message}`,
      );
      await this.mux.deleteLiveStream(liveStreamId).catch(err =>
        this.logger.error(`Compensating Mux delete failed (orphan ${liveStreamId}): ${err.message}`),
      );
      throw e;
    }

    await this.audit.log({
      action: 'stream.created',
      resourceType: 'stream',
      resourceId: row.id,
      summary: `Live stream "${row.title}" created`,
      metadata: { title: row.title, startsAt: row.starts_at },
    });

    return {
      ...toPublicStream(row),
      streamKey,
    };
  }

  async update(id: string, dto: UpdateStreamDto): Promise<PublicStream> {
    const { queryRunner } = this.getRlsContext();
    const sets: string[] = [];
    const params: any[] = [];
    if (dto.title !== undefined) {
      params.push(dto.title);
      sets.push(`title = $${params.length}`);
    }
    if (dto.startsAt !== undefined) {
      params.push(dto.startsAt);
      sets.push(`starts_at = $${params.length}`);
    }
    if (dto.endsAt !== undefined) {
      params.push(dto.endsAt);
      sets.push(`ends_at = $${params.length}`);
    }
    if (dto.thumbnailUrl !== undefined) {
      params.push(dto.thumbnailUrl);
      sets.push(`thumbnail_url = $${params.length}`);
    }
    if (dto.isLive !== undefined) {
      params.push(dto.isLive);
      sets.push(`is_live = $${params.length}`);
    }
    if (sets.length === 0) {
      const [row] = await queryRunner.query(
        `SELECT ${PUBLIC_STREAM_COLS} FROM public.streams WHERE id = $1`,
        [id],
      );
      if (!row) throw new NotFoundException('Stream not found');
      return toPublicStream(row);
    }
    params.push(id);
    const [row] = await queryRunner.query(
      `UPDATE public.streams SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING ${PUBLIC_STREAM_COLS}`,
      params,
    );
    if (!row) throw new NotFoundException('Stream not found');
    return toPublicStream(row);
  }

  /**
   * DELETE /api/streams/:id. Best-effort tear-down of the Mux live
   * stream too so it stops accepting RTMP (and stops billing). If we
   * dropped the local row but left the Mux stream up, anyone holding
   * the old stream_key could keep broadcasting under our account.
   */
  async delete(id: string): Promise<void> {
    const { queryRunner } = this.getRlsContext();
    const [row] = await queryRunner.query(
      `SELECT id, mux_live_stream_id FROM public.streams WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Stream not found');

    if (row.mux_live_stream_id) {
      await this.mux.deleteLiveStream(row.mux_live_stream_id).catch(err =>
        this.logger.error(`Mux delete of ${row.mux_live_stream_id} failed: ${err.message}`),
      );
    }
    await queryRunner.query(`DELETE FROM public.streams WHERE id = $1`, [id]);
  }
}
