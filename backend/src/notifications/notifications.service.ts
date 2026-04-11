import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { Notification } from './entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { ExpoPushService } from './expo-push.service';
import { IsNull } from 'typeorm';

export interface PaginatedNotifications {
  notifications: any[];
  unreadCount: number;
  total: number;
  page: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly expo: ExpoPushService,
  ) {}

  // ── Device Registration ──

  async registerDevice(userId: string, token: string, platform: string) {
    if (!['ios', 'android', 'web'].includes(platform)) {
      throw new BadRequestException('Platform must be ios, android, or web');
    }

    // Upsert device token
    await this.dataSource.query(
      `INSERT INTO public.device_tokens (user_id, token, platform, is_active, updated_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (user_id, token)
       DO UPDATE SET is_active = true, platform = $3, updated_at = now()`,
      [userId, token, platform],
    );

    this.logger.log(`Device registered for user ${userId}: ${token.slice(0, 25)}...`);
    return { registered: true };
  }

  async unregisterDevice(userId: string, token: string) {
    await this.dataSource.query(
      `UPDATE public.device_tokens SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND token = $2`,
      [userId, token],
    );
    return { unregistered: true };
  }

  // ── Notification List ──

  async getNotifications(userId: string, page = 1, limit = 30, unreadOnly = false) {
    const offset = (page - 1) * limit;
    const unreadFilter = unreadOnly ? `AND n.read_at IS NULL` : '';

    const rows = await this.dataSource.query(
      `SELECT n.id, n.type, n.title, n.body, n.data, n.read_at, n.created_at,
              n.sender_id,
              u.full_name AS sender_name, u.avatar_url AS sender_avatar
       FROM public.notifications n
       LEFT JOIN public.users u ON u.id = n.sender_id
       WHERE n.recipient_id = $1 ${unreadFilter}
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const [{ count: total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE recipient_id = $1 ${unreadFilter}`,
      [userId],
    );

    const [{ count: unreadCount }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [userId],
    );

    return {
      notifications: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        data: r.data,
        sender: r.sender_id ? {
          id: r.sender_id,
          fullName: r.sender_name,
          avatarUrl: r.sender_avatar,
        } : null,
        isRead: r.read_at !== null,
        createdAt: r.created_at,
      })),
      unreadCount: Number(unreadCount),
      total: Number(total),
      page,
    };
  }

  // ── Mark Read ──

  async markAsRead(notificationId: string, userId: string) {
    const result = await this.dataSource.query(
      `UPDATE public.notifications SET read_at = now() WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [notificationId, userId],
    );
    if (result[1] === 0) {
      // Could be already read or not found — check existence
      const [exists] = await this.dataSource.query(
        `SELECT 1 FROM public.notifications WHERE id = $1 AND recipient_id = $2`,
        [notificationId, userId],
      );
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { read: true };
  }

  async markAllAsRead(userId: string) {
    const result = await this.dataSource.query(
      `UPDATE public.notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { markedRead: result[1] ?? 0 };
  }

  // ── Unread Count ──

  async getUnreadCount(userId: string) {
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { count: Number(count) };
  }

  // ── Preferences ──

  async getPreferences(userId: string) {
    const prefs = await this.dataSource.query(
      `SELECT type, push_enabled, in_app_enabled, email_enabled
       FROM public.notification_preferences
       WHERE user_id = $1
       ORDER BY type`,
      [userId],
    );

    return {
      preferences: prefs.map((p: any) => ({
        type: p.type,
        pushEnabled: p.push_enabled,
        inAppEnabled: p.in_app_enabled,
        emailEnabled: p.email_enabled,
      })),
    };
  }

  async updatePreference(
    userId: string,
    type: string,
    pushEnabled?: boolean,
    inAppEnabled?: boolean,
    emailEnabled?: boolean,
  ) {
    await this.dataSource.query(
      `INSERT INTO public.notification_preferences (user_id, type, push_enabled, in_app_enabled, email_enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, type)
       DO UPDATE SET
         push_enabled = COALESCE($3, notification_preferences.push_enabled),
         in_app_enabled = COALESCE($4, notification_preferences.in_app_enabled),
         email_enabled = COALESCE($5, notification_preferences.email_enabled)`,
      [userId, type, pushEnabled ?? true, inAppEnabled ?? true, emailEnabled ?? false],
    );

    return { updated: true };
  }

  // ── Admin Broadcast ──

  async broadcast(
    senderId: string,
    title: string,
    body: string,
    tenantId?: string,
  ) {
    let recipientIds: string[];

    if (tenantId) {
      // Church-specific broadcast
      const rows = await this.dataSource.query(
        `SELECT user_id FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      );
      recipientIds = rows.map((r: any) => r.user_id);
    } else {
      // Platform-wide broadcast (all users)
      const rows = await this.dataSource.query(`SELECT id FROM public.users LIMIT 10000`);
      recipientIds = rows.map((r: any) => r.id);
    }

    if (recipientIds.length === 0) {
      return { sent: 0 };
    }

    await this.expo.sendBulk({
      recipientIds,
      senderId,
      tenantId: tenantId ?? '',
      type: tenantId ? 'church_broadcast' : 'system_broadcast',
      title,
      body,
      data: { screen: 'Announcements' },
    });

    return { sent: recipientIds.length };
  }

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException('RLS context unavailable.');
    }
    return context;
  }
}
