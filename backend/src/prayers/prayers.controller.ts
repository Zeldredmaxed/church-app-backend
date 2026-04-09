import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrayersService } from './prayers.service';
import { CreatePrayerDto } from './dto/create-prayer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Prayers')
@ApiBearerAuth()
@Controller('prayers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class PrayersController {
  constructor(private readonly prayersService: PrayersService) {}

  @Get()
  @ApiOperation({ summary: 'List prayer requests (cursor-paginated)' })
  getPrayers(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @CurrentUser() user?: SupabaseJwtPayload,
  ) {
    const validFilters = ['all', 'mine', 'answered'] as const;
    const safeFilter = validFilters.includes(filter as any) ? (filter as 'all' | 'mine' | 'answered') : 'all';
    return this.prayersService.getPrayers(
      safeFilter,
      user!.sub,
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      cursor,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a prayer request' })
  createPrayer(@Body() dto: CreatePrayerDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.prayersService.createPrayer(dto, user.sub);
  }

  @Post(':id/pray')
  @ApiOperation({ summary: 'Toggle praying for a prayer request' })
  togglePray(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.prayersService.togglePray(id, user.sub);
  }

  @Patch(':id/answer')
  @ApiOperation({ summary: 'Mark a prayer request as answered (author only)' })
  markAnswered(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.prayersService.markAnswered(id, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a prayer request (author or admin)' })
  deletePrayer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.prayersService.deletePrayer(id, user.sub);
  }
}
