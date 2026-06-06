import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Post as PostEntity } from '../posts/entities/post.entity';

@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly muxWebhookSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.muxWebhookSecret = this.config.get<string>('MUX_WEBHOOK_SECRET', '');
    if (!this.muxWebhookSecret) {
      new Logger(WebhooksController.name).warn('MUX_WEBHOOK_SECRET not configured — Mux webhooks will reject all requests');
    }
  }

  @Post('mux')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mux webhook receiver (HMAC-SHA256 verified, no JWT)' })
  @ApiResponse({ status: 200, description: '{ received: true }' })
  @ApiResponse({ status: 401, description: 'Invalid or missing mux-signature header' })
  async handleMuxWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ received: boolean }> {
    const signatureHeader = req.headers['mux-signature'] as string | undefined;

    if (!signatureHeader) {
      this.logger.warn('Mux webhook received without signature header');
      throw new UnauthorizedException('Missing mux-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Raw body not available. Ensure NestFactory.create has rawBody: true.',
      );
      throw new UnauthorizedException('Cannot verify signature: raw body unavailable');
    }

    const elements = signatureHeader.split(',');
    const timestampStr = elements.find(e => e.startsWith('t='))?.slice(2);
    const signatureStr = elements.find(e => e.startsWith('v1='))?.slice(3);

    if (!timestampStr || !signatureStr) {
      this.logger.warn('Mux webhook signature header malformed');
      throw new UnauthorizedException('Malformed mux-signature header');
    }

    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    const tolerance = 300;

    if (Math.abs(now - timestamp) > tolerance) {
      this.logger.warn(
        `Mux webhook timestamp too old: ${timestamp} (now: ${now}, delta: ${now - timestamp}s)`,
      );
      throw new UnauthorizedException('Webhook timestamp outside tolerance window');
    }

    const signedPayload = `${timestampStr}.${rawBody.toString('utf8')}`;
    const expectedSignature = createHmac('sha256', this.muxWebhookSecret)
      .update(signedPayload)
      .digest('hex');

    const sigBuffer = Buffer.from(signatureStr, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      this.logger.warn('Mux webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType = payload.type ?? 'unknown';
    const eventId = payload.id ?? payload.attempts?.[0]?.id;

    this.logger.log(`Mux webhook received: ${eventType} (id=${eventId})`);
    this.logger.debug(`Mux webhook payload: ${JSON.stringify(payload)}`);

    // Idempotency. Mux can replay any event — without this check, replays
    // re-overwrite playback_id, bump posts.updated_at, and could revert
    // status from 'errored' back to 'ready'. Mirrors the
    // stripe_processed_events pattern.
    if (eventId) {
      const dedupe = await this.dataSource.query(
        `INSERT INTO public.mux_processed_events (event_id)
         VALUES ($1) ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
      );
      if (dedupe.length === 0) {
        this.logger.log(`Mux webhook ${eventId} already processed — skipping`);
        return { received: true };
      }
    }

    // Mux event routing.
    //
    // Direct Upload lifecycle:
    //   video.upload.asset_created → asset_id assigned to the upload, but
    //                                playback isn't ready yet. We bind
    //                                asset_id to our pending row.
    //   video.asset.ready          → playback IDs exist. We copy the
    //                                playback_id to whatever post or story
    //                                claimed this upload.
    //
    // Older flow (S3 → Mux ingest) used asset.passthrough = post.id; that
    // path remains supported for backwards compatibility below.
    if (eventType === 'video.upload.asset_created') {
      await this.handleUploadAssetCreated(payload.data);
    } else if (eventType === 'video.asset.ready') {
      await this.handleAssetReady(payload.data);
    } else if (eventType === 'video.upload.errored' || eventType === 'video.asset.errored') {
      await this.handleAssetErrored(payload.data, eventType);
    } else if (eventType === 'video.live_stream.active') {
      await this.handleLiveStreamActive(payload.data, payload.created_at);
    } else if (eventType === 'video.live_stream.idle') {
      await this.handleLiveStreamIdle(payload.data, payload.created_at);
    }

    return { received: true };
  }

  /**
   * Mux says a pastor's encoder started pushing — flip the streams row
   * to is_live=true. Looked up by mux_live_stream_id so we don't need
   * the tenant in the webhook payload.
   *
   * Service-role write (dataSource, not queryRunner) because Mux webhooks
   * are unauthenticated — no RLS context exists and we'd never want one
   * here. The mux_live_stream_id lookup is the security boundary: the
   * Mux signature check upstream guarantees the event is genuine, and
   * only one row in our DB can carry that opaque id.
   */
  private async handleLiveStreamActive(data: any, eventCreatedAt?: string) {
    const liveStreamId = data?.id;
    if (!liveStreamId) {
      this.logger.warn(`video.live_stream.active without id: ${JSON.stringify(data)}`);
      return;
    }
    // Timestamp guard: Mux delivers at-least-once and can deliver events
    // out of order. If a delayed `active@T1` lands after `idle@T2` we'd
    // resurrect a dead stream. Only apply if the event is fresher than
    // the row's current state.
    const ts = eventCreatedAt ?? new Date().toISOString();
    const result = await this.dataSource.query(
      `UPDATE public.streams
       SET is_live = true, updated_at = now()
       WHERE mux_live_stream_id = $1 AND updated_at < $2::timestamptz
       RETURNING id`,
      [liveStreamId, ts],
    );
    if (result.length === 0) {
      this.logger.log(
        `video.live_stream.active: no-op for ${liveStreamId} (out-of-order event or no matching row)`,
      );
    } else {
      this.logger.log(`Stream ${result[0].id} is now LIVE (mux id ${liveStreamId})`);
    }
  }

  /**
   * Encoder stopped pushing — flip is_live=false and zero viewer_count
   * so stale viewers from the previous broadcast don't bleed into the
   * next session. Same timestamp guard as the active handler.
   */
  private async handleLiveStreamIdle(data: any, eventCreatedAt?: string) {
    const liveStreamId = data?.id;
    if (!liveStreamId) {
      this.logger.warn(`video.live_stream.idle without id: ${JSON.stringify(data)}`);
      return;
    }
    const ts = eventCreatedAt ?? new Date().toISOString();
    const result = await this.dataSource.query(
      `UPDATE public.streams
       SET is_live = false, viewer_count = 0, updated_at = now()
       WHERE mux_live_stream_id = $1 AND updated_at < $2::timestamptz
       RETURNING id`,
      [liveStreamId, ts],
    );
    if (result.length === 0) {
      this.logger.log(
        `video.live_stream.idle: no-op for ${liveStreamId} (out-of-order event or no matching row)`,
      );
    } else {
      this.logger.log(`Stream ${result[0].id} is now IDLE (mux id ${liveStreamId})`);
    }
  }

  /**
   * Mux just created an Asset for our Direct Upload. We resolve the
   * upload's passthrough (the pending_video_uploads row id) and store the
   * asset_id so the next webhook can find us by asset_id alone (the
   * asset.ready payload doesn't always echo upload context).
   */
  private async handleUploadAssetCreated(data: any) {
    const uploadId = data?.upload_id ?? data?.id;
    const assetId = data?.asset_id;
    const passthrough = data?.new_asset_settings?.passthrough ?? data?.passthrough;

    if (!assetId) {
      this.logger.warn(`video.upload.asset_created without asset_id: ${JSON.stringify(data)}`);
      return;
    }

    // Prefer passthrough (the pending row id we put on the upload); fall
    // back to mux_upload_id if Mux ever omits passthrough in this event.
    const where = passthrough ? 'id = $1' : 'mux_upload_id = $1';
    const key = passthrough ?? uploadId;
    if (!key) {
      this.logger.warn(`video.upload.asset_created: no passthrough or upload_id`);
      return;
    }

    const result = await this.dataSource.query(
      `UPDATE public.pending_video_uploads
       SET mux_asset_id = $2,
           status = CASE WHEN status = 'awaiting_upload' THEN 'processing' ELSE status END
       WHERE ${where}
       RETURNING id, post_id, story_id`,
      [key, assetId],
    );
    if (result.length === 0) {
      this.logger.warn(`video.upload.asset_created: no pending row for ${key}`);
    } else {
      this.logger.log(`Pending upload ${result[0].id} → asset ${assetId}`);
    }
  }

  /**
   * Mux finished transcoding. Two resolution paths:
   *   1. The asset's passthrough matches a post.id (legacy ingest flow) —
   *      update the post directly.
   *   2. Otherwise look up the pending row by mux_asset_id and propagate
   *      the playback_id to the linked post or story.
   */
  private async handleAssetReady(asset: any) {
    const playbackId = asset?.playback_ids?.[0]?.id;
    const passthrough = asset?.passthrough;
    const assetId = asset?.id;
    // Mux delivers aspect_ratio as "w:h" string ("16:9") OR per-track
    // max_width/max_height. safeAspect guards against zeros, NaN, and
    // audio-only assets — anything that would make the ratio Infinity,
    // NaN, or out of (0..100) returns null. The downstream UPDATE uses
    // COALESCE so a null new value leaves the existing media_aspect
    // alone (instead of tripping the migration-084 CHECK and crashing
    // the webhook into Mux's retry loop).
    const safeAspect = (a: any, b: any): number | null => {
      const w = Number(a);
      const h = Number(b);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
      const r = w / h;
      return r > 0 && r < 100 ? r : null;
    };
    const tracks = asset?.tracks ?? [];
    const videoTrack = tracks.find((t: any) => t.type === 'video');
    let mediaAspect: number | null = safeAspect(videoTrack?.max_width, videoTrack?.max_height);
    if (mediaAspect === null && typeof asset?.aspect_ratio === 'string' && /^\d+:\d+$/.test(asset.aspect_ratio)) {
      const [w, h] = asset.aspect_ratio.split(':');
      mediaAspect = safeAspect(w, h);
    }

    if (!playbackId) {
      this.logger.warn(`video.asset.ready missing playbackId: ${JSON.stringify({ assetId, passthrough })}`);
      return;
    }

    // Legacy path: passthrough is the post id.
    if (passthrough) {
      const updated = await this.dataSource.query(
        `UPDATE public.posts
         SET video_mux_playback_id = $1,
             transcode_status = 'ready',
             media_aspect = COALESCE($3, media_aspect),
             updated_at = now()
         WHERE id = $2`,
        [playbackId, passthrough, mediaAspect],
      );
      if (updated[1] > 0) {
        this.logger.log(`Legacy passthrough: updated post ${passthrough} with playback ${playbackId}`);
        return;
      }
      // Not a post — could be the pending-row UUID from the new flow.
      const rows = await this.dataSource.query(
        `UPDATE public.pending_video_uploads
         SET mux_playback_id = $1, status = 'ready', asset_ready_at = now()
         WHERE id = $2
         RETURNING post_id, story_id`,
        [playbackId, passthrough],
      );
      if (rows.length > 0) {
        await this.propagatePlayback(playbackId, mediaAspect, rows[0]);
        return;
      }
    }

    // Direct Upload path keyed by asset_id.
    if (assetId) {
      const rows = await this.dataSource.query(
        `UPDATE public.pending_video_uploads
         SET mux_playback_id = $1, status = 'ready', asset_ready_at = now()
         WHERE mux_asset_id = $2
         RETURNING post_id, story_id`,
        [playbackId, assetId],
      );
      if (rows.length > 0) {
        await this.propagatePlayback(playbackId, mediaAspect, rows[0]);
        return;
      }
    }

    this.logger.warn(
      `video.asset.ready: no destination resolved (passthrough=${passthrough}, assetId=${assetId})`,
    );
  }

  private async propagatePlayback(
    playbackId: string,
    mediaAspect: number | null,
    pending: { post_id: string | null; story_id: string | null },
  ) {
    if (pending.post_id) {
      await this.dataSource.query(
        `UPDATE public.posts
         SET video_mux_playback_id = $1,
             transcode_status = 'ready',
             media_aspect = COALESCE($3, media_aspect),
             updated_at = now()
         WHERE id = $2`,
        [playbackId, pending.post_id, mediaAspect],
      );
      this.logger.log(`Asset ready: post ${pending.post_id} → playback ${playbackId} aspect ${mediaAspect}`);
    }
    if (pending.story_id) {
      await this.dataSource.query(
        `UPDATE public.stories SET video_mux_playback_id = $1
         WHERE id = $2`,
        [playbackId, pending.story_id],
      );
      this.logger.log(`Asset ready: story ${pending.story_id} → playback ${playbackId}`);
    }
  }

  private async handleAssetErrored(data: any, eventType: string) {
    const message = data?.errors?.[0]?.messages?.[0] ?? data?.error?.message ?? eventType;
    const passthrough = data?.passthrough ?? data?.new_asset_settings?.passthrough;
    const assetId = data?.id ?? data?.asset_id;
    const uploadId = data?.upload_id;
    const key = passthrough ?? uploadId ?? assetId;
    if (!key) return;

    // Flip any post linked to this failed upload to transcode_status='failed'
    // so mobile's polling loop terminates instead of waiting forever.
    if (passthrough) {
      const pending = await this.dataSource.query(
        `SELECT post_id FROM public.pending_video_uploads WHERE id = $1`,
        [passthrough],
      );
      if (pending[0]?.post_id) {
        await this.dataSource.query(
          `UPDATE public.posts SET transcode_status = 'failed' WHERE id = $1`,
          [pending[0].post_id],
        );
      }
    } else if (uploadId) {
      const pending = await this.dataSource.query(
        `SELECT post_id FROM public.pending_video_uploads WHERE mux_upload_id = $1`,
        [uploadId],
      );
      if (pending[0]?.post_id) {
        await this.dataSource.query(
          `UPDATE public.posts SET transcode_status = 'failed' WHERE id = $1`,
          [pending[0].post_id],
        );
      }
    } else if (assetId) {
      const pending = await this.dataSource.query(
        `SELECT post_id FROM public.pending_video_uploads WHERE mux_asset_id = $1`,
        [assetId],
      );
      if (pending[0]?.post_id) {
        await this.dataSource.query(
          `UPDATE public.posts SET transcode_status = 'failed' WHERE id = $1`,
          [pending[0].post_id],
        );
      }
    }

    const where = passthrough
      ? 'id = $1'
      : uploadId
      ? 'mux_upload_id = $1'
      : 'mux_asset_id = $1';
    await this.dataSource.query(
      `UPDATE public.pending_video_uploads
       SET status = 'errored', error_message = $2
       WHERE ${where}`,
      [key, message.slice(0, 500)],
    );
    this.logger.warn(`Mux error on ${key}: ${message}`);
  }
}
