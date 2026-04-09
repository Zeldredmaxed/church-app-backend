import { Controller, Get, Post, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Moderation')
@ApiBearerAuth()
@Controller('admin/moderation')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  @ApiOperation({ summary: 'List post reports with counts' })
  getReports(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const validStatus = ['pending', 'reviewed', 'removed'].includes(status ?? '') ? (status as 'pending' | 'reviewed' | 'removed') : 'pending';
    return this.moderationService.getReports(validStatus, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a report (mark as reviewed)' })
  approveReport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.moderationService.approveReport(id, user.sub);
  }

  @Post(':id/remove')
  @ApiOperation({ summary: 'Remove a reported post' })
  removeReport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.moderationService.removeReport(id, user.sub);
  }
}
