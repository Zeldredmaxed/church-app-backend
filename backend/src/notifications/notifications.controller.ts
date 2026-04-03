import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for authenticated user' })
  @ApiResponse({ status: 200, description: 'Paginated array of notifications' })
  getNotifications(@Query() query: GetNotificationsDto) {
    return this.notificationsService.getNotifications(query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markAsRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markAsRead(id);
  }
}
