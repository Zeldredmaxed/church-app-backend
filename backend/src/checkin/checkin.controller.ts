import { Controller, Get, Post, Body, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CheckinService } from './checkin.service';
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
}
