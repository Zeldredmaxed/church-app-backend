import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SermonsService } from './sermons.service';
import { CreateSermonDto } from './dto/create-sermon.dto';
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
}
