import { Controller, Get, Param, ParseUUIDPipe, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BadgesService } from './badges.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@ApiTags('Badges')
@ApiBearerAuth()
@Controller('members')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class BadgesMemberController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get(':userId/badges')
  @ApiOperation({ summary: 'Get all badges for a specific member' })
  getMemberBadges(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.badgesService.getMemberBadges(userId);
  }
}
