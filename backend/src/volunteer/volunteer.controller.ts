import { Controller, Get, Post, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VolunteerService } from './volunteer.service';
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

  @Get('opportunities')
  @ApiOperation({ summary: 'List volunteer opportunities' })
  getOpportunities(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.volunteerService.getOpportunities(user.sub, Math.min(parseInt(limit ?? '20', 10) || 20, 100));
  }

  @Post('opportunities/:id/signup')
  @ApiOperation({ summary: 'Sign up for a volunteer opportunity' })
  signup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.volunteerService.signup(id, user.sub);
  }
}
