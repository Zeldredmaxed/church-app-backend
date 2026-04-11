import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CampusService, CreateCampusDto, UpdateCampusDto } from './campus.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TierGuard } from '../common/guards/tier.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresTier } from '../common/decorators/requires-tier.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Multi-Site / Campuses')
@ApiBearerAuth()
@Controller('tenants/:tenantId/campuses')
@UseGuards(JwtAuthGuard, TierGuard)
@RequiresTier('multiSite')
@UseInterceptors(RlsContextInterceptor)
export class CampusController {
  constructor(private readonly campusService: CampusService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new campus under this organization (enterprise only)' })
  @ApiResponse({ status: 201, description: 'Campus created' })
  @ApiResponse({ status: 403, description: 'Multi-site requires Enterprise plan' })
  createCampus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateCampusDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.campusService.createCampus(tenantId, dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List all campuses in this organization' })
  @ApiResponse({ status: 200, description: 'Array of campuses with member counts' })
  listCampuses(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.campusService.listCampuses(tenantId);
  }

  @Patch(':campusId')
  @ApiOperation({ summary: 'Update campus details or toggle feed isolation' })
  @ApiResponse({ status: 200, description: 'Campus updated' })
  updateCampus(
    @Param('campusId', ParseUUIDPipe) campusId: string,
    @Body() dto: UpdateCampusDto,
  ) {
    return this.campusService.updateCampus(campusId, dto);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Cross-campus aggregated analytics ("All" view)' })
  @ApiResponse({ status: 200, description: 'Org-wide KPIs with per-campus breakdown' })
  getOrgAnalytics(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('range') range?: string,
  ) {
    return this.campusService.getOrgAnalytics(tenantId, range ?? '30d');
  }

  @Get('members')
  @ApiOperation({ summary: 'Cross-campus member list ("All" view, de-duplicated)' })
  @ApiResponse({ status: 200, description: 'Paginated member list across all campuses' })
  getOrgMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.campusService.getOrgMembers(
      tenantId,
      cursor,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
    );
  }

  @Get('feed')
  @ApiOperation({ summary: 'Cross-campus social feed (respects feed_isolation toggle)' })
  @ApiResponse({ status: 200, description: 'Paginated posts from all campuses (or isolated)' })
  getOrgFeed(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.campusService.getOrgFeed(
      tenantId,
      user.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      parseInt(offset ?? '0', 10) || 0,
    );
  }
}
