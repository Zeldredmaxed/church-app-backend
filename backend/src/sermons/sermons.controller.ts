import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
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
  constructor(private readonly sermonsService: SermonsService) {}

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
    return this.sermonsService.getFeatured(user.app_metadata?.current_tenant_id!);
  }

  @Get('series')
  @ApiOperation({ summary: 'Get distinct sermon series with counts' })
  getSeries(@CurrentUser() user: SupabaseJwtPayload) {
    return this.sermonsService.getSeries(user.app_metadata?.current_tenant_id!);
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
    return this.sermonsService.createSermon(dto, user.app_metadata?.current_tenant_id!);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a sermon' })
  updateSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSermonDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.updateSermon(user.app_metadata?.current_tenant_id!, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a sermon' })
  deleteSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.deleteSermon(user.app_metadata?.current_tenant_id!, id);
  }

  @Get(':id/engagement')
  @ApiOperation({ summary: 'Get engagement stats for a sermon' })
  getEngagement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.sermonsService.getEngagement(user.app_metadata?.current_tenant_id!, id);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Like a sermon' })
  async likeSermon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    await this.sermonsService.likeSermon(user.app_metadata?.current_tenant_id!, id, user.sub);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record a sermon view' })
  recordView(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    // Fire-and-forget: don't await
    this.sermonsService.recordView(user.app_metadata?.current_tenant_id!, id);
  }
}
