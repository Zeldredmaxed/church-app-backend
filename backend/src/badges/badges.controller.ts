import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { BadgesService } from './badges.service';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { UpdateBadgeDto } from './dto/update-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Badges')
@ApiBearerAuth()
@Controller('badges')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class BadgesController {
  constructor(
    private readonly badgesService: BadgesService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('icons')
  @ApiOperation({ summary: 'Get paginated icon catalog for badge creation (with CDN preview URLs)' })
  getIconCatalog(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.badgesService.getIconCatalog(
      search,
      category,
      parseInt(page ?? '1', 10) || 1,
      Math.min(parseInt(limit ?? '30', 10) || 30, 100),
    );
  }

  @Get('global')
  @ApiOperation({ summary: 'Get all 250 platform-wide Shepard badges with rarity percentages' })
  getGlobalBadges(@CurrentUser() user: SupabaseJwtPayload) {
    return this.badgesService.getGlobalBadges(user.sub);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get badge leaderboard — top members by badge count' })
  getLeaderboard(@Query('limit') limit?: string) {
    return this.badgesService.getBadgeLeaderboard(Math.min(parseInt(limit ?? '20', 10) || 20, 100));
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get current user badge progress (all badges with current/target/percent)' })
  getMyProgress(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.badgesService.getMemberBadgeProgress(tenantId, user.sub);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check and auto-award badges for current user. Returns newly earned badges (for celebration overlay).' })
  async checkBadges(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    const newlyEarned = await this.badgesService.checkAndAwardAutoBadges(tenantId, user.sub);
    return { newlyEarned };
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all badges earned by a specific user' })
  getUserBadges(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.badgesService.getMemberBadges(userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all badge definitions for current tenant with award counts' })
  getBadges() {
    return this.badgesService.getBadges();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a badge' })
  createBadge(@Body() dto: CreateBadgeDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.badgesService.createBadge(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a badge' })
  updateBadge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBadgeDto) {
    return this.badgesService.updateBadge(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a badge (cascades awards)' })
  deleteBadge(@Param('id', ParseUUIDPipe) id: string) {
    return this.badgesService.deleteBadge(id);
  }

  @Post(':id/award')
  @ApiOperation({ summary: 'Award badge to one or more members' })
  awardBadge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AwardBadgeDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.badgesService.awardBadge(id, dto, user.sub);
  }

  @Delete(':id/revoke/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a badge from a member' })
  revokeBadge(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.badgesService.revokeBadge(id, userId);
  }
}
