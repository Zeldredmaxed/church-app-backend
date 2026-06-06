import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import sharp from 'sharp';

// Module-init sharp caps. Without these a single 12MP photo (~60-80MB
// decompressed RGBA) on Render's 512MB Starter OOMs at ~4 concurrent.
// cache(false): disables libvips operation cache — saves RSS.
// concurrency(1): caps libvips internal threads to 1; we handle
// per-request concurrency at the HTTP layer so libvips's fan-out is
// just wasted RAM.
sharp.cache(false);
sharp.concurrency(1);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;

/** Strips everything except alphanumeric, hyphens, underscores, and dots. */
function sanitizeFilename(raw: string): string {
  // Take only the basename (prevent path traversal via slashes/backslashes)
  const basename = raw.split(/[/\\]/).pop() || 'upload';
  // Replace unsafe characters; collapse multiple dots/hyphens
  return basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .slice(0, 200); // hard cap on key segment length
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly presignTtlSeconds = 300; // 5 minutes

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET', '');
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY', '');

    if (accessKeyId && !accessKeyId.includes('placeholder')) {
      this.s3 = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.s3 = null;
      this.logger.warn('AWS credentials not configured — media uploads disabled');
    }
  }

  /**
   * Generates a short-lived pre-signed PUT URL for uploading a file to S3.
   *
   * Security guarantees:
   *   1. The S3 key is namespaced by tenantId/userId — prevents key collisions
   *      and ensures data isolation between tenants and users.
   *   2. The filename is sanitised to strip path traversal characters.
   *   3. Content-Type is locked in the pre-signed URL — the client cannot
   *      upload a different MIME type than declared.
   *   4. The URL expires after 5 minutes — limits the window for misuse.
   *   5. Only authenticated users with an active tenant context can request URLs.
   */
  private ensureS3(): S3Client {
    if (!this.s3) throw new InternalServerErrorException('S3 is not configured');
    return this.s3;
  }

  async generatePresignedUrl(
    dto: PresignedUrlDto,
    tenantId: string,
    userId: string,
  ): Promise<PresignedUrlResponse> {
    if (!tenantId) {
      throw new BadRequestException(
        'No active tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    const sanitized = sanitizeFilename(dto.filename);
    const timestamp = Date.now();
    const fileKey = `tenants/${tenantId}/users/${userId}/${timestamp}_${sanitized}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: dto.contentType,
    });

    try {
      const uploadUrl = await getSignedUrl(this.ensureS3(), command, {
        expiresIn: this.presignTtlSeconds,
      });

      this.logger.log(
        `Pre-signed URL generated: ${fileKey} (tenant: ${tenantId}, user: ${userId})`,
      );

      return { uploadUrl, fileKey };
    } catch (error) {
      this.logger.error(`Failed to generate pre-signed URL: ${error}`);
      throw new InternalServerErrorException('Failed to generate upload URL');
    }
  }

  /**
   * Deletes all S3 objects for a user across all their tenant namespaces.
   *
   * Used by the GDPR "Right to Erasure" flow. Lists all objects under
   * tenants/TENANT_ID/users/USER_ID/ and batch-deletes them.
   *
   * This is best-effort — S3 failures are logged but do not prevent
   * account deletion. The user's DB records are the authoritative source;
   * orphaned S3 objects can be cleaned up via lifecycle rules.
   *
   * @param tenantIds - All tenant IDs the user had memberships in
   * @param userId - The user's UUID
   * @returns Number of objects deleted
   */
  async deleteUserObjects(tenantIds: string[], userId: string): Promise<number> {
    let totalDeleted = 0;

    for (const tenantId of tenantIds) {
      const prefix = `tenants/${tenantId}/users/${userId}/`;

      try {
        // List all objects under this user's prefix
        let continuationToken: string | undefined;

        do {
          const listResult = await this.ensureS3().send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
          );

          const objects = listResult.Contents;
          if (!objects || objects.length === 0) break;

          // Batch delete (S3 supports up to 1000 objects per request)
          await this.ensureS3().send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: objects.map((obj) => ({ Key: obj.Key! })),
                Quiet: true,
              },
            }),
          );

          totalDeleted += objects.length;
          continuationToken = listResult.NextContinuationToken;
        } while (continuationToken);

        this.logger.log(
          `Deleted S3 objects for user ${userId} in tenant ${tenantId}`,
        );
      } catch (error) {
        // Best-effort — log and continue. Orphaned objects can be cleaned
        // up via S3 lifecycle rules or a periodic cleanup job.
        this.logger.error(
          `Failed to delete S3 objects for user ${userId} in tenant ${tenantId}: ${error}`,
        );
      }
    }

    return totalDeleted;
  }

  /**
   * Server-side EXIF strip + aspect-ratio probe. The mobile uploads
   * images directly to S3 via the presigned URL, so the server never
   * sees the bytes in flight; without this step the EXIF GPS metadata
   * the OS attached at capture time would survive in S3 and leak in
   * every downstream consumer.
   *
   * Flow:
   *   1. Mobile PUTs image bytes to the presigned URL → S3
   *   2. Mobile calls POST /api/media/finalize-image with the fileKey
   *   3. This method GETs the object, runs through sharp (re-encode →
   *      strips EXIF/IPTC/XMP), re-uploads to the same key, returns
   *      the public URL + media aspect ratio.
   *
   * sharp's default behavior IS to strip metadata on re-encode (you have
   * to opt-IN with .withMetadata() to preserve it). We just call .rotate()
   * which respects orientation EXIF then drops it. ~50ms per image at
   * typical mobile-photo sizes.
   */
  async finalizeImage(fileKey: string): Promise<{ url: string; mediaAspect: number; bytes: number }> {
    const s3 = this.ensureS3();

    // HEAD first — refuse anything over 15MB BEFORE we GET the bytes.
    // Without this a malicious upload of e.g. 500MB would be fully
    // streamed into memory before sharp ever sees it.
    const head = await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: fileKey }));
    if (!head.ContentLength) {
      throw new BadRequestException('Object not found or empty');
    }
    if (head.ContentLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `Image too large: ${head.ContentLength} bytes exceeds ${MAX_IMAGE_BYTES} byte cap`,
      );
    }

    const get = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: fileKey }));
    if (!get.Body) throw new BadRequestException('Object not found');

    // Stream → buffer. AWS SDK v3 streams are AsyncIterable.
    const chunks: Buffer[] = [];
    for await (const chunk of get.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const inputBuffer = Buffer.concat(chunks);

    // .rotate() reads + drops EXIF orientation; .toBuffer() re-encodes
    // and (because we don't call .withMetadata()) drops all metadata
    // including GPS, camera-make/model, software, original-date, etc.
    // limitInputPixels caps decompressed pixel count — defends against
    // small files declaring absurd dimensions (decompression bomb).
    const pipeline = sharp(inputBuffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    const metadata = await pipeline.metadata();
    const outputBuffer = await pipeline.toBuffer();
    const mediaAspect =
      metadata.width && metadata.height ? metadata.width / metadata.height : 1;

    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        Body: outputBuffer,
        ContentType: get.ContentType ?? 'image/jpeg',
      }),
    );

    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const url = `https://${this.bucket}.s3.${region}.amazonaws.com/${fileKey}`;
    return { url, mediaAspect, bytes: outputBuffer.length };
  }
}
