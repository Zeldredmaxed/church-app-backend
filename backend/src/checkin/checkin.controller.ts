import { Controller, Get, Post, Body, Query, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CheckinService } from './checkin.service';
import { BulkCheckinDto } from './dto/bulk-checkin.dto';
import { AddVisitorDto } from './dto/add-visitor.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Check-In')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class CheckinController {
  constructor(private readonly checkinService: CheckinService) {}

  @Get('services/current')
  @ApiOperation({ summary: 'Get services for today' })
  getCurrentServices() {
    return this.checkinService.getCurrentServices();
  }

  @Post('check-in')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Check in to a service' })
  checkIn(@Body() body: { serviceId?: string }, @CurrentUser() user: SupabaseJwtPayload) {
    return this.checkinService.checkIn(user.sub, body.serviceId);
  }

  @Get('attendance/services')
  @ApiOperation({ summary: 'Get all services for tenant (all days)' })
  @ApiResponse({ status: 200, description: 'Array of service schedules' })
  getAllServices(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new Error('No active tenant context');
    return this.checkinService.getAllServices(tenantId);
  }

  @Get('attendance/roster')
  @ApiOperation({ summary: 'Get attendance roster for a date' })
  @ApiResponse({ status: 200, description: 'Array of members with check-in status' })
  getRoster(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('serviceId') serviceId?: string,
    @Query('date') date?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new Error('No active tenant context');
    return this.checkinService.getRoster(tenantId, serviceId, date);
  }

  @Post('attendance/bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk check-in multiple users' })
  @ApiResponse({ status: 201, description: '{ checkedIn: number }' })
  bulkCheckIn(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: BulkCheckinDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new Error('No active tenant context');
    return this.checkinService.bulkCheckIn(tenantId, dto.userIds, dto.serviceId);
  }

  @Get('attendance/kpis')
  @ApiOperation({ summary: 'Get attendance KPI metrics' })
  @ApiResponse({ status: 200, description: 'Attendance KPIs' })
  getAttendanceKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new Error('No active tenant context');
    return this.checkinService.getAttendanceKpis(tenantId);
  }

  @Post('attendance/visitors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a visitor check-in' })
  @ApiResponse({ status: 201, description: 'Visitor recorded' })
  addVisitor(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: AddVisitorDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new Error('No active tenant context');
    return this.checkinService.addVisitor(tenantId, dto);
  }
}
