import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Media')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a pre-signed S3 upload URL (5 min expiry)' })
  @ApiResponse({ status: 200, description: 'Returns uploadUrl and fileKey for direct S3 upload' })
  @ApiResponse({ status: 400, description: 'No active tenant context' })
  generatePresignedUrl(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: PresignedUrlDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id ?? null;
    return this.mediaService.generatePresignedUrl(dto, tenantId, user.sub);
  }
}
