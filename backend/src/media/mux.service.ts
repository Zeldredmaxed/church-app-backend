import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mux from '@mux/mux-node';

/**
 * Wraps the Mux Node SDK so we have a single, well-typed injection point.
 *
 * The SDK is instantiated lazily on first use so the app boots even when
 * MUX_TOKEN_ID / MUX_TOKEN_SECRET aren't set (e.g. local dev without
 * video). Any call that actually needs Mux will throw with a clear error
 * if creds are missing.
 */
@Injectable()
export class MuxService {
  private readonly logger = new Logger(MuxService.name);
  private client: Mux | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Mux {
    if (this.client) return this.client;
    const tokenId = this.config.get<string>('MUX_TOKEN_ID');
    const tokenSecret = this.config.get<string>('MUX_TOKEN_SECRET');
    if (!tokenId || !tokenSecret) {
      throw new InternalServerErrorException(
        'Mux credentials are not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.',
      );
    }
    this.client = new Mux({ tokenId, tokenSecret });
    return this.client;
  }

  /**
   * Creates a Direct Upload — Mux returns a signed URL the mobile client
   * can PUT raw bytes to. Asset processing kicks off automatically once
   * the upload completes, and `video.upload.asset_created` + then
   * `video.asset.ready` webhooks land on our /api/webhooks/mux endpoint.
   *
   * `passthrough` is the opaque ID we use to correlate the Mux upload
   * back to our `pending_video_uploads` row (we pass the row's UUID).
   *
   * `corsOrigin` defaults to '*' which is correct for native mobile
   * clients — the PUT happens outside any browser CORS context. For
   * a future web upload, callers should pass an explicit origin.
   */
  async createDirectUpload(params: {
    passthrough: string;
    corsOrigin?: string;
    /** Default 30 min. Mux supports up to 3600s. */
    timeoutSeconds?: number;
  }): Promise<{ uploadId: string; uploadUrl: string }> {
    const mux = this.getClient();

    const upload = await mux.video.uploads.create({
      cors_origin: params.corsOrigin ?? '*',
      timeout: params.timeoutSeconds ?? 1800,
      new_asset_settings: {
        playback_policies: ['public'],
        // mp4_support lets the mobile fall back to a static MP4 rendition
        // for offline / poor-connection scenarios. 'capped-1080p' caps the
        // bitrate ladder at 1080p which is plenty for a social feed and
        // saves transcoding cost vs. 4k.
        mp4_support: 'capped-1080p',
        video_quality: 'basic',
        passthrough: params.passthrough,
      },
    });

    if (!upload.url || !upload.id) {
      this.logger.error(`Mux upload returned without URL or ID: ${JSON.stringify(upload)}`);
      throw new InternalServerErrorException('Mux did not return a valid upload');
    }

    return { uploadId: upload.id, uploadUrl: upload.url };
  }
}
