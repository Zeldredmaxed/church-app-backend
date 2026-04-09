import { Controller, Get, Post, Body, Query, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('announcements')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'List announcements (cursor-paginated)' })
  getAnnouncements(
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const validFilter = ['all', 'urgent', 'week'].includes(filter ?? '') ? (filter as 'all' | 'urgent' | 'week') : 'all';
    return this.announcementsService.getAnnouncements(validFilter, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an announcement' })
  createAnnouncement(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.announcementsService.createAnnouncement(dto, user.sub);
  }
}
