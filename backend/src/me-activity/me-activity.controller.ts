import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { MeActivityService } from './me-activity.service';
import { HeartbeatDto } from './dto/heartbeat.dto';

@ApiTags('Activity')
@ApiBearerAuth()
@Controller('me/activity')
@UseGuards(JwtAuthGuard)
export class MeActivityController {
  constructor(private readonly meActivityService: MeActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'Activity dashboard summary — thisWeek + lifetime in one round-trip',
    description: 'Designed to render the top card of the Your Activity screen immediately. Section detail endpoints land in deploy 2.',
  })
  @ApiResponse({ status: 200, description: 'Summary object' })
  getSummary(@CurrentUser() user: SupabaseJwtPayload) {
    return this.meActivityService.getSummary(user.sub);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Per-day minutes + opens for the activity bar chart' })
  @ApiQuery({ name: 'range', required: false, enum: ['week', 'month', 'all'] })
  @ApiResponse({ status: 200, description: '{ range, totalMinutes, totalOpens, currentStreakDays, longestStreakDays, daily[] }' })
  getUsage(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('range') range?: 'week' | 'month' | 'all',
  ) {
    return this.meActivityService.getUsage(user.sub, range ?? 'week');
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 1000, limit: 2 } })
  @ApiOperation({
    summary: 'Foreground activity ping — mobile sends every 60s while in foreground',
    description: 'Body: { deltaSeconds: 0-90, isNewSession?: boolean }. deltaSeconds is clamped at 90 server-side to defend against spoofing. isNewSession increments session_count exactly once per foreground activation.',
  })
  @ApiResponse({ status: 200, description: '{ ok: true }' })
  heartbeat(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: HeartbeatDto,
  ) {
    return this.meActivityService.heartbeat(user.sub, dto);
  }

  // ───────── Deploy 2 — per-section detail endpoints ─────────

  @Get('posts')
  @ApiOperation({ summary: 'Posts I authored (excludes archived)' })
  getMyPosts(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyPosts(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('comments')
  @ApiOperation({ summary: 'Comments I authored, joined to parent post for context' })
  getMyComments(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyComments(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('likes')
  @ApiOperation({ summary: 'Posts I liked (excludes archived)' })
  getMyLikes(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyLikes(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('story-views')
  @ApiOperation({ summary: 'Stories I viewed (most recent first)' })
  getMyStoryViews(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyStoryViews(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('family')
  @ApiOperation({ summary: 'Family activity — sent + received requests + accepted ties' })
  getMyFamily(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No current tenant. Call POST /auth/switch-tenant first.');
    return this.meActivityService.getMyFamily(user.sub, tenantId);
  }

  @Get('giving')
  @ApiOperation({ summary: 'My donations + lifetime + year-to-date totals' })
  getMyGiving(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyGiving(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('events')
  @ApiOperation({ summary: "Events I RSVP'd to (?status=upcoming|past, default upcoming)" })
  @ApiQuery({ name: 'status', required: false, enum: ['upcoming', 'past'] })
  getMyEvents(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('status') status?: 'upcoming' | 'past',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyEvents(
      user.sub,
      status ?? 'upcoming',
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('checkins')
  @ApiOperation({ summary: 'Service check-ins + lifetime total + week streak' })
  getMyCheckins(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.meActivityService.getMyCheckins(
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('prayers')
  @ApiOperation({ summary: 'Prayers I posted + prayers I prayed for' })
  getMyPrayers(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No current tenant. Call POST /auth/switch-tenant first.');
    return this.meActivityService.getMyPrayers(
      user.sub,
      tenantId,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }

  @Get('logins')
  @ApiOperation({ summary: 'Recent sign-in events (last 10)' })
  getMyLogins(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.meActivityService.getMyLogins(
      user.sub,
      Math.min(parseInt(limit ?? '10', 10) || 10, 50),
    );
  }
}
