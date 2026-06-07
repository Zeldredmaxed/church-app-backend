import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { VolunteerService } from './volunteer.service';
import { LogHoursDto } from './dto/log-hours.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

class VerifyHoursDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('Volunteer')
@ApiBearerAuth()
@Controller('volunteer')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  @Get('kpis')
  @ApiOperation({ summary: 'Get volunteer KPI metrics' })
  @ApiResponse({ status: 200, description: 'Volunteer KPIs: activeVolunteers, hoursThisMonth' })
  getVolunteerKpis(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.getVolunteerKpis(tenantId);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Get volunteer schedule with assigned volunteers' })
  @ApiResponse({ status: 200, description: 'Array of opportunities with volunteer lists' })
  getSchedule(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.getSchedule(tenantId);
  }

  @Get('opportunities')
  @ApiOperation({ summary: 'List volunteer opportunities' })
  getOpportunities(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.volunteerService.getOpportunities(user.sub, Math.min(parseInt(limit ?? '20', 10) || 20, 100));
  }

  @Post('hours')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Log volunteer hours' })
  @ApiResponse({ status: 201, description: 'Volunteer hours logged' })
  logHours(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: LogHoursDto,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.logHours(tenantId, dto);
  }

  @Post('opportunities/:id/signup')
  @ApiOperation({ summary: 'Sign up for a volunteer opportunity' })
  signup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.volunteerService.signup(id, user.sub);
  }

  /**
   * Member-facing withdraw — symmetric to POST signup. Idempotent
   * (returns `{ withdrawn: true }` whether or not the caller was
   * previously signed up). Audit row is emitted so the volunteer
   * coordinator can see the change in the queue.
   */
  @Delete('opportunities/:id/signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw the caller\'s signup from a volunteer opportunity' })
  @ApiResponse({ status: 200, description: '{ withdrawn: true }' })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.volunteerService.withdrawSignup(id, user.sub);
  }

  @Get('hours/pending')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({
    summary: 'List unverified volunteer-hour rows (admin/pastor)',
    description:
      'Self-reported hours that have not yet been confirmed by an admin. Surfaces a pending-verification queue for the admin dashboard.',
  })
  @ApiResponse({ status: 200, description: '{ pending: [...], count }' })
  listPendingHours(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.listPendingVerification(tenantId);
  }

  @Post('hours/:id/verify')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify (approve) a volunteer-hours row',
    description:
      'Sets verified_by, verified_at, and (optional) verification_reason. Audits volunteer.hours_verified. Verified rows count toward tenant KPIs; pending rows do not.',
  })
  @ApiResponse({ status: 200, description: '{ verified: true }' })
  @ApiResponse({ status: 404, description: 'Hours row not found in this tenant' })
  verifyHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyHoursDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.verifyHours(tenantId, id, user.sub, dto.reason);
  }

  @Post('hours/:id/reject')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a volunteer-hours row (deletes the row + audits)',
  })
  @ApiResponse({ status: 200, description: '{ rejected: true }' })
  rejectHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyHoursDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.volunteerService.rejectHours(tenantId, id, user.sub, dto.reason);
  }
}
