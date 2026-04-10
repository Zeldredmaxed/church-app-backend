import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get()
  @ApiOperation({ summary: 'Get storage usage summary for current tenant' })
  @ApiResponse({ status: 200, description: 'Storage usage with limits and percent' })
  getStorageUsage(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.storageService.getStorageUsage(tenantId);
  }

  @Get('breakdown')
  @ApiOperation({ summary: 'Get storage breakdown by content type' })
  @ApiResponse({ status: 200, description: 'Bytes used per source type (posts, sermons, gallery, etc.)' })
  getBreakdown(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.storageService.getStorageBreakdown(tenantId);
  }

  @Get('files')
  @ApiOperation({ summary: 'Get largest files for storage management' })
  @ApiResponse({ status: 200, description: 'List of largest files with metadata' })
  getLargestFiles(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.storageService.getLargestFiles(tenantId, Math.min(parseInt(limit ?? '50', 10) || 50, 100));
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file and free up storage' })
  @ApiResponse({ status: 204, description: 'File deleted, storage reclaimed' })
  deleteFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.storageService.recordDeletion(tenantId, fileId);
  }
}
