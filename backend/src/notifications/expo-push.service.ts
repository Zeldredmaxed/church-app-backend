import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';

/**
 * Expo Push Notification service.
 *
 * Handles the full notification lifecycle:
 *   1. Insert in-app notification row
 *   2. Check user preferences
 *   3. Fetch device tokens
 *   4. Send via Expo Push API
 *   5. Handle invalid tokens (mark as inactive)
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo = new Expo();

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Send a notification to a single user.
   * Creates the in-app row and sends push if preferences allow.
   */
  async send(params: {
    recipientId: string;
    senderId?: string;
    tenantId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<Notification> {
    // 1. Skip self-notifications
    if (params.senderId && params.recipientId === params.senderId) {
      this.logger.debug(`Skipping self-notification for ${params.recipientId}`);
      return {} as Notification;
    }

    // 2. Insert in-app notification
    const notification = await this.dataSource.manager.save(
      Notification,
      this.dataSource.manager.create(Notification, {
        recipientId: params.recipientId,
        senderId: params.senderId ?? null,
        tenantId: params.tenantId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data ?? {},
        payload: params.data ?? {},
      }),
    );

    // 3. Check user preferences
    const pref = await this.dataSource.manager.findOne(NotificationPreference, {
      where: { userId: params.recipientId, type: params.type },
    });
    if (pref && !pref.pushEnabled) {
      this.logger.debug(`Push disabled for ${params.recipientId} type=${params.type}`);
      return notification;
    }

    // 4. Get active device tokens
    const devices = await this.dataSource.manager.find(DeviceToken, {
      where: { userId: params.recipientId, isActive: true },
    });
    if (devices.length === 0) {
      this.logger.log(
        `In-app notification ${notification.id} created for user ${params.recipientId} (${params.type}); push skipped — no active device tokens registered`,
      );
      return notification;
    }

    // 5. Build and send Expo messages
    const validDevices = devices.filter(d => Expo.isExpoPushToken(d.token));
    if (validDevices.length === 0) {
      this.logger.warn(
        `Push skipped for user ${params.recipientId}: ${devices.length} device(s) registered but none have valid Expo tokens`,
      );
      return notification;
    }

    // Get unread count for badge
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM public.notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [params.recipientId],
    );

    const messages: ExpoPushMessage[] = validDevices.map(d => ({
      to: d.token,
      title: params.title,
      body: params.body,
      data: params.data,
      sound: 'default' as const,
      badge: Number(count),
      channelId: this.getChannelId(params.type),
    }));

    await this.sendMessages(messages, validDevices);
    return notification;
  }

  /**
   * Send a notification to multiple users (bulk).
   * Used for church-wide announcements, event notifications, etc.
   */
  async sendBulk(params: {
    recipientIds: string[];
    senderId?: string;
    tenantId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    // Batch insert notifications
    const notifications = params.recipientIds
      .filter(id => id !== params.senderId)
      .map(recipientId =>
        this.dataSource.manager.create(Notification, {
          recipientId,
          senderId: params.senderId ?? null,
          tenantId: params.tenantId,
          type: params.type,
          title: params.title,
          body: params.body,
          data: params.data ?? {},
          payload: params.data ?? {},
        }),
      );

    // Save in batches of 100
    for (let i = 0; i < notifications.length; i += 100) {
      await this.dataSource.manager.save(Notification, notifications.slice(i, i + 100));
    }

    // Get all active device tokens for recipients (excluding those with push disabled)
    const disabledUsers = await this.dataSource.query(
      `SELECT user_id FROM public.notification_preferences WHERE type = $1 AND push_enabled = false`,
      [params.type],
    );
    const disabledSet = new Set(disabledUsers.map((r: any) => r.user_id));

    const eligibleIds = params.recipientIds.filter(
      id => id !== params.senderId && !disabledSet.has(id),
    );

    if (eligibleIds.length === 0) return;

    const devices = await this.dataSource.query(
      `SELECT user_id, token FROM public.device_tokens WHERE user_id = ANY($1) AND is_active = true`,
      [eligibleIds],
    );

    const validDevices = devices.filter((d: any) => Expo.isExpoPushToken(d.token));
    if (validDevices.length === 0) return;

    const messages: ExpoPushMessage[] = validDevices.map((d: any) => ({
      to: d.token,
      title: params.title,
      body: params.body,
      data: params.data,
      sound: 'default' as const,
      channelId: this.getChannelId(params.type),
    }));

    await this.sendMessages(messages, validDevices);
    this.logger.log(`Bulk push sent: ${messages.length} devices for ${params.type}`);
  }

  /**
   * Send messages via Expo and handle invalid tokens.
   */
  private async sendMessages(messages: ExpoPushMessage[], devices: any[]): Promise<void> {
    const chunks = this.expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const results: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);

        // Mark invalid tokens as inactive
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === 'error') {
            const details = (result as any).details;
            if (details?.error === 'DeviceNotRegistered') {
              const token = devices[i]?.token;
              if (token) {
                await this.dataSource.query(
                  `UPDATE public.device_tokens SET is_active = false WHERE token = $1`,
                  [token],
                );
                this.logger.log(`Deactivated invalid token: ${token.slice(0, 20)}...`);
              }
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Expo push send failed: ${err.message}`);
      }
    }
  }

  /** Map notification type to Android notification channel. */
  private getChannelId(type: string): string {
    if (type.startsWith('post_') || type.startsWith('comment_') || type === 'new_follower' || type === 'follow_request') return 'social';
    if (type.startsWith('new_message') || type.startsWith('message_') || type === 'group_message') return 'messages';
    if (type.startsWith('new_sermon') || type.startsWith('live_') || type === 'new_announcement') return 'content';
    if (type.startsWith('church_') || type.startsWith('system_')) return 'announcements';
    if (type.startsWith('donation_') || type.startsWith('giving_') || type.startsWith('fundraiser_')) return 'giving';
    if (type.includes('reminder') || type === 'checkin_reminder') return 'reminders';
    return 'default';
  }
}
