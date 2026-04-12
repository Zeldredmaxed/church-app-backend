import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsUUID, IsIn, IsOptional, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

class ReportContentDto {
  @IsUUID()
  contentId: string;

  @IsIn(['post', 'comment', 'user', 'message'])
  contentType: 'post' | 'comment' | 'user' | 'message';

  @IsString()
  @MaxLength(500)
  reason: string;
}

/**
 * User-facing safety endpoints for reporting content and blocking users.
 * Required by Apple App Store and Google Play for apps with user-generated content.
 */
@ApiTags('Safety')
@ApiBearerAuth()
@Controller('safety')
@UseGuards(JwtAuthGuard)
export class UserSafetyController {
  constructor(private readonly dataSource: DataSource) {}

  // ── Report Content ──

  @Post('report')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report a post, comment, user, or message' })
  @ApiResponse({ status: 201, description: 'Report submitted' })
  async reportContent(
    @Body() dto: ReportContentDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');

    await this.dataSource.query(
      `INSERT INTO public.post_reports (tenant_id, reported_by, post_id, comment_id, user_id, content_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        tenantId,
        user.sub,
        dto.contentType === 'post' ? dto.contentId : null,
        dto.contentType === 'comment' ? dto.contentId : null,
        dto.contentType === 'user' ? dto.contentId : null,
        dto.contentType,
        dto.reason,
      ],
    );

    return { reported: true, message: 'Thank you for reporting. Our team will review this.' };
  }

  // ── Block User ──

  @Post('block/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user (hides their content from your feed)' })
  @ApiResponse({ status: 200, description: '{ blocked: true }' })
  async blockUser(
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    if (blockedUserId === user.sub) {
      throw new BadRequestException('You cannot block yourself');
    }

    await this.dataSource.query(
      `INSERT INTO public.user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [user.sub, blockedUserId],
    );

    return { blocked: true };
  }

  @Delete('block/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock a user' })
  @ApiResponse({ status: 200, description: '{ unblocked: true }' })
  async unblockUser(
    @Param('userId', ParseUUIDPipe) blockedUserId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    await this.dataSource.query(
      `DELETE FROM public.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [user.sub, blockedUserId],
    );

    return { unblocked: true };
  }

  @Get('blocked')
  @ApiOperation({ summary: 'List users you have blocked' })
  @ApiResponse({ status: 200, description: 'Array of blocked users' })
  async getBlockedUsers(@CurrentUser() user: SupabaseJwtPayload) {
    const rows = await this.dataSource.query(
      `SELECT ub.blocked_id, u.full_name, u.avatar_url, ub.created_at
       FROM public.user_blocks ub
       JOIN public.users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = $1
       ORDER BY ub.created_at DESC`,
      [user.sub],
    );

    return rows.map((r: any) => ({
      userId: r.blocked_id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      blockedAt: r.created_at,
    }));
  }
}
