import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PresignedUrlDto } from './dto/presigned-url.dto';

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
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly presignTtlSeconds = 300; // 5 minutes

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');

    this.s3 = new S3Client({
      region: this.config.getOrThrow<string>('S3_REGION'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
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
      const uploadUrl = await getSignedUrl(this.s3, command, {
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
   * `tenants/*/users/{userId}/` and batch-deletes them.
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
          const listResult = await this.s3.send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
          );

          const objects = listResult.Contents;
          if (!objects || objects.length === 0) break;

          // Batch delete (S3 supports up to 1000 objects per request)
          await this.s3.send(
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
}
