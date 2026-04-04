import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { TierCheckService } from '../common/services/tier-check.service';

@ApiTags('Media')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly tierCheck: TierCheckService,
  ) {}

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a pre-signed S3 upload URL (5 min expiry)' })
  @ApiResponse({ status: 200, description: 'Returns uploadUrl and fileKey for direct S3 upload' })
  @ApiResponse({ status: 400, description: 'No active tenant context' })
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

    return this.mediaService.generatePresignedUrl(dto, tenantId, user.sub);
  }
}
