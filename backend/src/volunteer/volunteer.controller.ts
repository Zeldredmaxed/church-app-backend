import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VolunteerService } from './volunteer.service';
import { LogHoursDto } from './dto/log-hours.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Volunteer')
@ApiBearerAuth()
@Controller('volunteer')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
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
}
