import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List events (cursor-paginated)' })
  getEvents(
    @Query('upcoming') upcoming?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.eventsService.getEvents(upcoming === 'true', Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single event with RSVP status' })
  getEvent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.eventsService.getEvent(id, user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an event (admin: manage_content)' })
  createEvent(@Body() dto: CreateEventDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.eventsService.createEvent(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event (admin: manage_content)' })
  updateEvent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEventDto) {
    return this.eventsService.updateEvent(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an event (admin: manage_content)' })
  deleteEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.deleteEvent(id);
  }

  @Post(':id/rsvp')
  @ApiOperation({ summary: 'RSVP to an event' })
  rsvp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RsvpDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.eventsService.rsvp(id, user.sub, dto.status);
  }

  @Get(':id/attendees')
  @ApiOperation({ summary: 'List event attendees' })
  getAttendees(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.eventsService.getAttendees(id, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }
}
