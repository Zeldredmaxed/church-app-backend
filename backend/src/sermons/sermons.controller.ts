import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SermonsService } from './sermons.service';
import { CreateSermonDto } from './dto/create-sermon.dto';
import { UpdateSermonDto } from './dto/update-sermon.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Sermons')
@ApiBearerAuth()
@Controller('sermons')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class SermonsController {
  private readonly logger = new Logger(SermonsController.name);

  constructor(private readonly sermonsService: SermonsService) {}

  private getTenantId(user: SupabaseJwtPayload): string {
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new BadRequestException('No tenant context');
    return tenantId;
  }

  @Get()
  @ApiOperation({ summary: 'List sermons (cursor-paginated)' })
  getSermons(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const validFilter = ['all', 'recent', 'series', 'topics'].includes(filter ?? '') ? (filter as 'all' | 'recent' | 'series' | 'topics') : 'all';
    return this.sermonsService.getSermons(validFilter, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Get('featured')
  @ApiOperation({ summary: 'Get the featured sermon' })
  getFeatured(@CurrentUser() user: SupabaseJwtPayload) {
    return this.sermonsService.getFeatured(this.getTenantId(user));
  }

  @Get('series')
  @ApiOperation({ summary: 'Get distinct sermon series with counts' })
  getSeries(@CurrentUser() user: SupabaseJwtPayload) {
    return this.sermonsService.getSeries(this.getTenantId(user));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single sermon' })
  getSermon(@Param('id', ParseUUIDPipe) id: string) {
    return this.sermonsService.getSermon(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a sermon' })
  createSermon(@Body() dto: CreateSermonDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.sermonsService.createSermon(dto, this.getTenantId(user));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a sermon' })
  updateSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSermonDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.updateSermon(this.getTenantId(user), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a sermon' })
  deleteSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.deleteSermon(this.getTenantId(user), id);
  }

  @Get(':id/engagement')
  @ApiOperation({ summary: 'Get engagement stats for a sermon' })
  getEngagement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.getEngagement(this.getTenantId(user), id);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Like a sermon' })
  async likeSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    await this.sermonsService.likeSermon(this.getTenantId(user), id, user.sub);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record a sermon view' })
  recordView(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    // Fire-and-forget with error logging
    this.sermonsService.recordView(this.getTenantId(user), id)
      .catch(err => this.logger.error('Failed to record sermon view', err));
  }
}
