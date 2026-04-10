import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
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
    if (!tenantId) throw new BadRequestException('No tenant context');
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
    if (!tenantId) throw new BadRequestException('No tenant context');
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
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.bulkCheckIn(tenantId, dto.userIds, dto.serviceId);
  }

  @Get('attendance/kpis')
  @ApiOperation({ summary: 'Get attendance KPI metrics' })
  @ApiResponse({ status: 200, description: 'Attendance KPIs' })
  getAttendanceKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
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
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.addVisitor(tenantId, dto);
  }

  // ─── Child Check-in Safety ───

  @Post('checkin/child')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Check in a child with guardian linking + security code' })
  @ApiResponse({ status: 201, description: 'Child checked in with security code + label data' })
  checkInChild(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() body: { childId?: string; childName?: string; guardianId: string; serviceId?: string },
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.checkInChild(tenantId, body);
  }

  @Get('checkin/child/:securityCode/verify')
  @ApiOperation({ summary: 'Verify a child pickup security code' })
  @ApiResponse({ status: 200, description: 'Verification result with child info + authorized pickups' })
  verifyPickupCode(
    @Param('securityCode') securityCode: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.verifyPickupCode(tenantId, securityCode);
  }

  @Get('members/:userId/medical-alerts')
  @ApiOperation({ summary: 'Get medical/allergy alerts for a member' })
  getMedicalAlerts(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.getMedicalAlerts(tenantId, userId);
  }

  @Post('members/:userId/medical-alerts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a medical/allergy alert for a member' })
  addMedicalAlert(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { alertType: string; description: string; severity?: string },
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.addMedicalAlert(tenantId, userId, body, user.sub);
  }

  @Delete('members/:userId/medical-alerts/:alertId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a medical/allergy alert' })
  deleteMedicalAlert(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.checkinService.deleteMedicalAlert(tenantId, alertId);
  }
}
