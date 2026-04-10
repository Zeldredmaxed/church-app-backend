import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import { GeoCheckinDto } from './dto/geo-checkin.dto';
import { UpdateCheckinConfigDto } from './dto/update-checkin-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

// ---------------------------------------------------------------------------
// LeaderboardController — /leaderboard
// ---------------------------------------------------------------------------
@ApiTags('Leaderboard')
@ApiBearerAuth()
@Controller('leaderboard')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get leaderboard entries for a category' })
  @ApiResponse({ status: 200, description: 'Leaderboard with entries, myRank, myValue' })
  getLeaderboard(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('category') category?: string,
    @Query('scope') scope?: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const validCategory = ['check_ins', 'giving', 'attendance', 'posts'].includes(category ?? '')
      ? (category as 'check_ins' | 'giving' | 'attendance' | 'posts')
      : 'check_ins';
    const validScope = ['church', 'global'].includes(scope ?? '')
      ? (scope as 'church' | 'global')
      : 'church';
    const validPeriod = ['all_time', 'this_month', 'this_week'].includes(period ?? '')
      ? (period as 'all_time' | 'this_month' | 'this_week')
      : 'all_time';
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 100);
    return this.leaderboardService.getLeaderboard(tenantId, user.sub, validCategory, validScope, validPeriod, parsedLimit);
  }

  @Get('my-ranks')
  @ApiOperation({ summary: 'Get current user top-10 ranks across all categories and scopes' })
  @ApiResponse({ status: 200, description: 'Array of rank entries where user is in top 10' })
  getMyRanks(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.leaderboardService.getMyRanks(tenantId, user.sub);
  }

  @Get('user/:userId/ranks')
  @ApiOperation({ summary: 'Get a user\'s top-10 ranks across all categories and scopes' })
  @ApiResponse({ status: 200, description: 'Array of rank entries where user is in top 10' })
  getUserRanks(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.leaderboardService.getUserRanks(tenantId, userId);
  }

  @Post('app-open')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record daily app open (fire-and-forget)' })
  @ApiResponse({ status: 204, description: 'Recorded' })
  recordAppOpen(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    // Fire-and-forget — do not await
    this.leaderboardService.recordAppOpen(tenantId, user.sub).catch((err) => {
      // Swallow errors silently — this is non-critical
    });
  }

  @Put('visibility')
  @ApiOperation({ summary: 'Toggle leaderboard visibility for current user' })
  @ApiResponse({ status: 200, description: '{ visible: boolean }' })
  toggleVisibility(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() body: { visible: boolean },
  ) {
    return this.leaderboardService.toggleVisibility(user.sub, body.visible);
  }
}

// ---------------------------------------------------------------------------
// CheckinConfigController — /admin
// ---------------------------------------------------------------------------
@ApiTags('Admin — Check-In Config')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class CheckinConfigController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('check-in-config')
  @ApiOperation({ summary: 'Get geo check-in configuration for the tenant' })
  @ApiResponse({ status: 200, description: 'Check-in config object' })
  getCheckinConfig(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.leaderboardService.getCheckinConfig(tenantId);
  }

  @Put('check-in-config')
  @ApiOperation({ summary: 'Update geo check-in configuration' })
  @ApiResponse({ status: 200, description: 'Updated config' })
  updateCheckinConfig(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdateCheckinConfigDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.leaderboardService.updateCheckinConfig(tenantId, dto);
  }
}

// ---------------------------------------------------------------------------
// GeoCheckinController — /attendance
// ---------------------------------------------------------------------------
@ApiTags('Attendance — Geo Check-In')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class GeoCheckinController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Post('geo-check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Geo-fenced check-in from mobile app' })
  @ApiResponse({ status: 200, description: '{ success, message, distance? }' })
  geoCheckIn(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: GeoCheckinDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.leaderboardService.geoCheckIn(tenantId, user.sub, dto.lat, dto.lng);
  }
}
