import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  @ApiOperation({ summary: 'Get all dashboard KPI cards' })
  @ApiResponse({ status: 200, description: 'KPI summary for the current tenant' })
  getKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.dashboardService.getKpis(tenantId);
  }

  @Get('giving-chart')
  @ApiOperation({ summary: 'Monthly giving totals for chart' })
  @ApiResponse({ status: 200, description: 'Array of { month, total }' })
  getGivingChart(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('range') range?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const validRange = ['6m', '12m', '24m'].includes(range ?? '') ? (range as '6m' | '12m' | '24m') : '6m';
    return this.dashboardService.getGivingChart(tenantId, validRange);
  }

  @Get('attendance-chart')
  @ApiOperation({ summary: 'Weekly attendance counts for chart (last 12 weeks)' })
  @ApiResponse({ status: 200, description: 'Array of { week, count }' })
  getAttendanceChart(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.dashboardService.getAttendanceChart(tenantId);
  }

  @Get('growth-chart')
  @ApiOperation({ summary: 'Monthly new member counts for growth chart' })
  @ApiResponse({ status: 200, description: 'Array of { month, count }' })
  getGrowthChart(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.dashboardService.getGrowthChart(tenantId);
  }

  @Get('care-summary')
  @ApiOperation({ summary: 'Care summary (placeholder until care module is built)' })
  @ApiResponse({ status: 200, description: 'Care case counts' })
  getCareSummary(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.dashboardService.getCareSummary(tenantId);
  }

  @Get('upcoming-events')
  @ApiOperation({ summary: 'Next 5 upcoming events for the dashboard widget' })
  @ApiResponse({ status: 200, description: 'Array of upcoming events' })
  getUpcomingEvents(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.dashboardService.getUpcomingEvents(tenantId);
  }

  @Get('activity-feed')
  @ApiOperation({ summary: 'Recent activity feed across posts, events, prayers, announcements' })
  @ApiResponse({ status: 200, description: 'Array of { type, id, title, createdAt }' })
  getActivityFeed(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 50);
    return this.dashboardService.getActivityFeed(tenantId, parsedLimit);
  }
}
