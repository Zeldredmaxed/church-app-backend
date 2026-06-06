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
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsUUID, IsIn } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { DeleteNotificationsDto } from './dto/delete-notifications.dto';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPE_KEYS } from './notifications.types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
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
  @IsIn(NOTIFICATION_TYPE_KEYS as string[])
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
  @ApiOperation({ summary: 'List notifications for the authenticated user (offset-paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated notifications with unread count' })
  getNotifications(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query() query: GetNotificationsDto,
  ) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.notificationsService.getNotifications(
      user.sub,
      offset,
      limit,
      query.unreadOnly === true,
    );
  }

  // ── Unread Count (must be before :id param routes) ──

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count (for badge on bell icon)' })
  getUnreadCount(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.getUnreadCount(user.sub);
  }

  // ── Preferences ──

  @Get('categories')
  @ApiOperation({
    summary: 'Notification type catalog for the preferences screen',
    description:
      'Returns the canonical list of notification types with labels, grouping, and channel defaults. The mobile preferences UI should render from this list (do NOT hardcode types client-side).',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ categories: [{ key, label, description, group, defaultPush, defaultEmail, defaultSms }] }',
  })
  getCategories() {
    return { categories: NOTIFICATION_CATEGORIES };
  }

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
  @ApiOperation({ summary: 'Mark all notifications as read (PUT)' })
  markAllAsReadPut(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.markAllAsRead(user.sub);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read (POST alias)' })
  markAllAsReadPost(@CurrentUser() user: SupabaseJwtPayload) {
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

  // ── Delete ──
  // Static routes must precede :id-param routes — Nest matches in declaration
  // order. DELETE / (batch) is declared before DELETE /:id below; the batch
  // route has no extra path segment, so they don't conflict.

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch-delete notifications by id',
    description: 'Body: { ids: [uuid, ...] }. Only ids the caller owns are deleted; others are silently skipped. Returns the actual count deleted.',
  })
  @ApiResponse({ status: 200, description: '{ deletedCount: N }' })
  deleteNotifications(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: DeleteNotificationsDto,
  ) {
    return this.notificationsService.deleteNotifications(dto.ids, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Notification not found or not the recipient' })
  deleteNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.notificationsService.deleteNotification(id, user.sub);
  }

  // ── Admin Broadcast ──

  @Post('broadcast')
  @UseGuards(RoleGuard)
  @RequiresRole('admin')
  // RlsContextInterceptor populates rlsStorage so AuditService.log() inside
  // the service can read actor + request context.
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a push broadcast to all church members or all users (admin only)' })
  broadcast(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: BroadcastDto,
  ) {
    return this.notificationsService.broadcast(user.sub, dto.title, dto.body, dto.tenantId);
  }

  @Get('broadcasts/history')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({
    summary: 'List past broadcasts with delivery stats (admin/pastor)',
    description:
      'Returns the most recent broadcast_history rows for the current tenant with sender name + audience + delivered/failed/read counts. Lets the admin dashboard answer "did 412 of 800 phones actually get it?"',
  })
  @ApiResponse({ status: 200, description: '{ broadcasts: [...] }' })
  getBroadcastHistory(@CurrentUser() user: SupabaseJwtPayload) {
    return this.notificationsService.getBroadcastHistory(user.app_metadata?.current_tenant_id!);
  }
}
