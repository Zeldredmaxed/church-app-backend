import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FacilitiesService } from './facilities.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Facilities')
@ApiBearerAuth()
@Controller('facilities')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  @Get('rooms')
  @ApiOperation({ summary: 'List all rooms with current availability' })
  getRooms(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.getRooms(tenantId);
  }

  @Get('rooms/:roomId/calendar')
  @ApiOperation({ summary: 'Get bookings for a room in a date range' })
  getRoomCalendar(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.getRoomCalendar(tenantId, roomId, start, end);
  }

  @Post('bookings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a room booking' })
  createBooking(@Body() dto: CreateBookingDto, @CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.createBooking(tenantId, dto, user.sub);
  }

  @Put('bookings/:id')
  @ApiOperation({ summary: 'Update a room booking' })
  updateBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateBookingDto>,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.updateBooking(tenantId, id, dto);
  }

  @Delete('bookings/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a room booking' })
  cancelBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.cancelBooking(tenantId, id);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Get hourly availability slots for a room on a given day' })
  getAvailability(
    @Query('roomId') roomId: string,
    @Query('date') date: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.facilitiesService.getAvailability(tenantId, roomId, date);
  }
}
