import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { CancelEventDto } from './dto/cancel-event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChurchOnly } from '../common/guards/church-only.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
@ChurchOnly()
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

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an event (admin: manage_content)',
    description:
      'Marks the event cancelled (keeps it visible so RSVPs see what happened) and notifies all "going"/"interested" attendees. Distinct from DELETE which removes the event entirely.',
  })
  @ApiResponse({ status: 200, description: 'Event cancelled — { id, cancelledAt, cancellationReason }' })
  cancelEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelEventDto,
  ) {
    return this.eventsService.cancelEvent(id, dto.reason ?? null);
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

  @Post('ical/regenerate-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate or rotate the public iCal token for this tenant',
    description:
      'Returns { token, url } — admin uses the url to give Google/Apple/Outlook a subscribe link. Calling again rotates the token and invalidates the previous URL.',
  })
  async regenerateIcalToken(@CurrentUser() user: SupabaseJwtPayload) {
    return this.eventsService.regenerateIcalToken(user.app_metadata?.current_tenant_id!);
  }
}

/**
 * Public iCal feed controller. Separate from EventsController so the
 * JwtAuthGuard at the class level doesn't 401 external calendar
 * subscribers (Google/Apple/Outlook can't carry a bearer token).
 *
 * Auth is via a per-tenant rotatable token in the query string.
 */
import { Controller as PublicController } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Events — Public iCal')
@PublicController('events/ical-public')
@SkipThrottle()
export class PublicICalController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':tenantId')
  @ApiOperation({
    summary: 'Public iCal subscription feed (token-authenticated, no JWT)',
    description:
      'External calendars subscribe to this URL. The ?token= must match the tenant\'s ical_token (generate via POST /events/ical/regenerate-token).',
  })
  async getPublicICal(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const ical = await this.eventsService.getPublicICalFeed(tenantId, token);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="events.ics"',
      'Cache-Control': 'public, max-age=900', // 15 min — calendars poll
    });
    res.send(ical);
  }
}
