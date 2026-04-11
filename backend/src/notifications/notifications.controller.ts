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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsUUID, IsIn } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

class RegisterDeviceDto {
  @IsString()
  token: string;

  @IsIn(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';
}

class UnregisterDeviceDto {
  @IsString()
  token: string;
}

class UpdatePreferenceDto {
  @IsString()
  type: string;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;
}

class BroadcastDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ── Device Registration ──

  @Post('register-device')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register an Expo push token for the authenticated user' })
  registerDevice(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(user.sub, dto.token, dto.platform);
  }

  @Delete('unregister-device')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a push token (call on logout)' })
  unregisterDevice(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UnregisterDeviceDto,
  ) {
    return this.notificationsService.unregisterDevice(user.sub, dto.token);
  }

  // ── Notification List ──

  @Get()
  @ApiOperation({ summary: 'List notifications for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Paginated notifications with unread count' })
  getNotifications(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unread_only') unreadOnly?: string,
  ) {
    return this.notificationsService.getNotifications(
      user.sub,
      parseInt(page ?? '1', 10) || 1,
      Math.min(parseInt(limit ?? '30', 10) || 30, 100),
      unreadOnly === 'true',
    );
  }

  // ── Unread Count (must be before :id param routes) ──

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count (for badge on bell icon)' })
  getUnreadCount(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.getUnreadCount(user.sub);
  }

  // ── Preferences ──

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences for all types' })
  getPreferences(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.getPreferences(user.sub);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preference for a specific type' })
  updatePreference(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdatePreferenceDto,
  ) {
    return this.notificationsService.updatePreference(
      user.sub,
      dto.type,
      dto.pushEnabled,
      dto.inAppEnabled,
      dto.emailEnabled,
    );
  }

  // ── Mark Read ──

  @Put('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark a specific notification as read' })
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.notificationsService.markAsRead(id, user.sub);
  }

  // ── Admin Broadcast ──

  @Post('broadcast')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a push broadcast to all church members or all users (admin only)' })
  broadcast(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: BroadcastDto,
  ) {
    return this.notificationsService.broadcast(user.sub, dto.title, dto.body, dto.tenantId);
  }
}
