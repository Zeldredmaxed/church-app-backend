import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { MediaService } from './media.service';
import { MuxService } from './mux.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { MuxUploadDto } from './dto/mux-upload.dto';
import { FinalizeImageDto } from './dto/finalize-image.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { TierCheckService } from '../common/services/tier-check.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('Media')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly muxService: MuxService,
    private readonly tierCheck: TierCheckService,
    private readonly storageService: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a pre-signed S3 upload URL (5 min expiry)' })
  @ApiResponse({ status: 200, description: 'Returns uploadUrl and fileKey for direct S3 upload' })
  @ApiResponse({ status: 400, description: 'No active tenant context' })
  @ApiResponse({ status: 403, description: 'Storage limit reached or video uploads not allowed' })
  async generatePresignedUrl(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: PresignedUrlDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) {
      throw new BadRequestException('No active tenant context');
    }

    // Video uploads require Pro tier or higher
    if (dto.contentType.startsWith('video/')) {
      await this.tierCheck.requireFeature(tenantId, 'videoUploads');
    }

    // Check storage limit before allowing upload
    await this.storageService.checkStorageLimit(tenantId, dto.fileSize);

    // Generate presigned URL
    const result = await this.mediaService.generatePresignedUrl(dto, tenantId, user.sub);

    // Record the upload in the storage ledger
    await this.storageService.recordUpload(
      tenantId,
      user.sub,
      result.fileKey,
      dto.fileSize,
      dto.contentType,
    );

    return result;
  }

  @Post('finalize-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Server-side EXIF strip + aspect probe after a presigned-URL upload',
    description:
      'Mobile pattern: PUT bytes to the presigned URL → call this endpoint with the returned fileKey. ' +
      'Backend GETs from S3, runs the image through sharp (re-encode strips all EXIF/IPTC/XMP, including GPS), ' +
      'PUTs the cleaned bytes back to the same key, returns the public URL + mediaAspect ratio. ' +
      'Idempotent — calling twice on a clean image is a no-op aside from the round-trip cost.',
  })
  @ApiResponse({ status: 200, description: '{ url, mediaAspect, bytes }' })
  @ApiResponse({ status: 400, description: 'fileKey missing or object not found' })
  @ApiResponse({ status: 403, description: 'fileKey does not belong to the caller' })
  async finalizeImage(
    @Body() dto: FinalizeImageDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    // Path-traversal + ownership check. Regex on DTO blocks the
    // obviously-malformed prefix shape; this verifies the prefix
    // matches the caller's own tenant+user namespace. Without this an
    // authenticated guest user could pass any tenant's key and DoS
    // their images via the sharp round-trip.
    const expectedPrefix = `tenants/${tenantId}/users/${user.sub}/`;
    if (!dto.fileKey.startsWith(expectedPrefix) || dto.fileKey.includes('..')) {
      throw new ForbiddenException('fileKey not owned by caller');
    }

    return this.mediaService.finalizeImage(dto.fileKey);
  }

  @Post('mux-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a Mux Direct Upload URL for a video',
    description:
      'Returns a signed Mux upload URL the mobile client PUTs raw video bytes to. We allocate a pending_video_uploads row keyed by the returned uploadId; the Mux webhook later fills in asset_id + playback_id. Mobile sends the uploadId (and optional cropRect) when creating the post via POST /api/posts.',
  })
  @ApiResponse({
    status: 200,
    description: '{ uploadId, uploadUrl } — PUT bytes to uploadUrl, then create the post with videoMuxUploadId = uploadId.',
  })
  @ApiResponse({ status: 400, description: 'No active tenant context' })
  @ApiResponse({ status: 403, description: 'Video uploads not allowed on this tier' })
  async createMuxUpload(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: MuxUploadDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No active tenant context');

    // Tier gate: same as the S3 video path. Direct Upload bypasses our
    // bandwidth but it's still a feature gate, not a free-for-all.
    await this.tierCheck.requireFeature(tenantId, 'videoUploads');

    // Allocate our pending row first so the upload row exists before Mux
    // ingests anything. Passthrough = the pending row's UUID — the webhook
    // uses it to find the row when video.upload.asset_created arrives.
    const [pending] = await this.dataSource.query(
      `INSERT INTO public.pending_video_uploads (tenant_id, user_id, mux_upload_id, status)
       VALUES ($1, $2, 'pending', 'awaiting_upload')
       RETURNING id`,
      [tenantId, user.sub],
    );

    const { uploadId, uploadUrl } = await this.muxService.createDirectUpload({
      passthrough: pending.id,
      corsOrigin: dto.corsOrigin,
    });

    // Mux returned the actual upload ID — replace the placeholder.
    await this.dataSource.query(
      `UPDATE public.pending_video_uploads SET mux_upload_id = $1 WHERE id = $2`,
      [uploadId, pending.id],
    );

    return { uploadId, uploadUrl };
  }
}
