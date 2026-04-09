import { Controller, Get, Param, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BadgesService } from './badges.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Badges')
@ApiBearerAuth()
@Controller('members')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class BadgesMemberController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get(':userId/badges')
  @ApiOperation({ summary: 'Get all badges earned by a specific member' })
  getMemberBadges(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.badgesService.getMemberBadges(userId);
  }

  @Get(':userId/badge-progress')
  @ApiOperation({ summary: 'Get badge progress for a member — current vs target with percent for each badge' })
  getMemberBadgeProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.badgesService.getMemberBadgeProgress(tenantId, userId);
  }
}
