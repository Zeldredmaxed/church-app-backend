import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('giving-yoy')
  @ApiOperation({ summary: 'Year-over-year giving comparison' })
  @ApiResponse({ status: 200, description: 'Monthly giving YoY data' })
  getGivingYoY(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.getGivingYoY(tenantId);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Discipleship funnel counts' })
  @ApiResponse({ status: 200, description: 'Funnel data' })
  getFunnel(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.getFunnel(tenantId);
  }

  @Get('engagement')
  @ApiOperation({ summary: 'Member engagement score distribution' })
  @ApiResponse({ status: 200, description: 'Engagement buckets' })
  getEngagement(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.getEngagement(tenantId);
  }

  @Get('giving-by-fund')
  @ApiOperation({ summary: 'Giving breakdown by fund' })
  @ApiResponse({ status: 200, description: 'Giving by fund' })
  getGivingByFund(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.getGivingByFund(tenantId);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'YTD report KPIs' })
  @ApiResponse({ status: 200, description: 'KPI summary' })
  getReportKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.getReportKpis(tenantId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export data for CSV' })
  @ApiResponse({ status: 200, description: 'Raw rows for export' })
  exportData(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('type') type: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.reportsService.exportData(tenantId, type);
  }
}
