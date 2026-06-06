import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AttendanceService } from './attendance.service';
import {
  CreateServiceDto,
  UpdateServiceDto,
  SetOptInDto,
  PingDto,
  CancelOccurrenceDto,
} from './dto/service.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

// ════════════════════════════════════════════════════════════════════
// Admin services CRUD — /api/services
// ════════════════════════════════════════════════════════════════════
@ApiTags('Attendance — Services (admin)')
@ApiBearerAuth()
@Controller('services')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
export class ServicesController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @ApiOperation({ summary: 'List all services for the current tenant' })
  @ApiResponse({ status: 200, description: 'Array of services with upcoming-occurrence count' })
  list(@CurrentUser() user: SupabaseJwtPayload) {
    return this.attendance.listServices(user.app_metadata?.current_tenant_id!);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new service slot' })
  @ApiResponse({ status: 201, description: 'Service created' })
  create(@CurrentUser() user: SupabaseJwtPayload, @Body() dto: CreateServiceDto) {
    return this.attendance.createService(user.app_metadata?.current_tenant_id!, user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a service' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.attendance.updateService(user.app_metadata?.current_tenant_id!, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a service (soft delete — is_active=false)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.attendance.deleteService(user.app_metadata?.current_tenant_id!, id);
  }

  @Post('occurrences/:occurrenceId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a specific service occurrence (holiday, weather, etc.)',
    description:
      'Marks the occurrence is_cancelled=true so the start-push cron skips it and the end-sweep computes no attendance. Members already pinged before cancellation keep their ping rows but no service_attendance is written.',
  })
  cancelOccurrence(
    @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
    @Body() dto: CancelOccurrenceDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.attendance.cancelOccurrence(
      user.app_metadata?.current_tenant_id!,
      occurrenceId,
      user.sub,
      dto.reason,
    );
  }

  @Get('occurrences/:occurrenceId/attendance')
  @ApiOperation({
    summary: 'Admin: attendance roster for one occurrence',
    description:
      'Returns counts (total/present/absent/late/leftEarly) and per-attendee rows with first/last in-radius timestamps. One row per opted-in member only.',
  })
  getOccurrenceAttendance(
    @Param('occurrenceId', ParseUUIDPipe) occurrenceId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.attendance.getOccurrenceAttendance(
      user.app_metadata?.current_tenant_id!,
      occurrenceId,
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// Member-facing endpoints — /api/attendance
// ════════════════════════════════════════════════════════════════════
@ApiTags('Attendance — Auto Check-In (member)')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(JwtAuthGuard)
@ChurchOnly()
@UseInterceptors(RlsContextInterceptor)
export class AttendanceMemberController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('opt-in')
  @ApiOperation({
    summary: 'Get my auto-attendance opt-in state + upcoming ping times',
    description:
      'Returns { optedIn, optedInAt, optedOutAt, upcomingOccurrences } where upcoming is the next 14 days of service occurrences for the current tenant. The mobile renders these times on the opt-in screen for transparency ("here is exactly when your location would be pinged").',
  })
  getOptIn(@CurrentUser() user: SupabaseJwtPayload) {
    return this.attendance.getOptIn(user.sub, user.app_metadata?.current_tenant_id!);
  }

  @Post('opt-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set my auto-attendance opt-in state',
    description:
      'Per-(user, tenant). Set optedIn=true to enable auto-attendance pings for the current church; false to disable (no future pings recorded). Switching churches resets — opt-in is per-church.',
  })
  setOptIn(@CurrentUser() user: SupabaseJwtPayload, @Body() dto: SetOptInDto) {
    return this.attendance.setOptIn(user.sub, user.app_metadata?.current_tenant_id!, dto.optedIn);
  }

  @Post('ping')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Auto-attendance ping (background location update)',
    description:
      'Mobile-side geofence handlers + foreground location updates POST here. Backend silently drops the ping if the user has not opted in. Otherwise, finds the active service occurrence (if any), computes distance + in_radius, and records the row. Throttled 30/min per IP — generous for foreground spam but blocks runaway background loops.',
  })
  @ApiResponse({ status: 200, description: '{ recorded, pingId?, serviceOccurrenceId?, distance?, inRadius? }' })
  ping(@CurrentUser() user: SupabaseJwtPayload, @Body() dto: PingDto) {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return this.attendance.recordPing(user.sub, tenantId, dto);
  }

  @Get('upcoming')
  @ApiOperation({
    summary: 'Public to members: upcoming service occurrences for the next N days',
    description:
      'Same shape as getOptIn.upcomingOccurrences but standalone — for a "your church\'s services" widget on the home screen.',
  })
  getUpcoming(@CurrentUser() user: SupabaseJwtPayload, @Query('days') days?: string) {
    const parsedDays = Math.min(Math.max(parseInt(days ?? '14', 10) || 14, 1), 60);
    return this.attendance.getUpcomingForMember(
      user.app_metadata?.current_tenant_id!,
      parsedDays,
    );
  }
}
