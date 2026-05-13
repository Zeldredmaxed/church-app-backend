import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
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
}
