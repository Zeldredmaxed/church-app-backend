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
    /**
     * Optional idempotency key. When the notifications BullMQ queue
     * retries (attempts: 5), the same job lands here multiple times —
     * without a dedupe key, every retry inserts another notification row
     * and re-pushes (up to 5× duplicate). Pass `job.id` or a deterministic
     * `${type}:${recipientId}:${sourceId}` so retries are no-ops.
     */
    dedupeKey?: string;
  }): Promise<Notification> {
    // 1. Skip self-notifications
    if (params.senderId && params.recipientId === params.senderId) {
      this.logger.debug(`Skipping self-notification for ${params.recipientId}`);
      return {} as Notification;
    }

    // 2. Insert in-app notification with dedupe.
    // Partial UNIQUE index on dedupe_key (migration 073) means a retry
    // hits the conflict path and we look up the existing row instead of
    // double-inserting + double-pushing.
    let notification: Notification;
    if (params.dedupeKey) {
      const inserted = await this.dataSource.query(
        `INSERT INTO public.notifications
           (recipient_id, sender_id, tenant_id, type, title, body, data, payload, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $7::jsonb, $8)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          params.recipientId,
          params.senderId ?? null,
          params.tenantId,
          params.type,
          params.title,
          params.body,
          JSON.stringify(params.data ?? {}),
          params.dedupeKey,
        ],
      );
      if (inserted.length === 0) {
        this.logger.debug(
          `Notification dedupe_key ${params.dedupeKey} already processed — skipping`,
        );
        return {} as Notification;
      }
      notification = inserted[0] as Notification;
    } else {
      notification = await this.dataSource.manager.save(
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
    }

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
   * Send a push notification to a user WITHOUT creating an in-app
   * notifications row. Use when the caller has already inserted the
   * notification synchronously (e.g., family service does its own INSERT
   * for correctness guarantees and just needs the push delivered).
   *
   * Respects per-type push preference and active device tokens. Returns
   * silently if there's nothing to send.
   */
  async sendPushOnly(params: {
    recipientId: string;
    senderId?: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    if (params.senderId && params.recipientId === params.senderId) return;

    const pref = await this.dataSource.manager.findOne(NotificationPreference, {
      where: { userId: params.recipientId, type: params.type },
    });
    if (pref && !pref.pushEnabled) return;

    const devices = await this.dataSource.manager.find(DeviceToken, {
      where: { userId: params.recipientId, isActive: true },
    });
    if (devices.length === 0) {
      this.logger.log(
        `Push skipped for user ${params.recipientId} (${params.type}) — no active device tokens registered`,
      );
      return;
    }

    const validDevices = devices.filter(d => Expo.isExpoPushToken(d.token));
    if (validDevices.length === 0) return;

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
    /**
     * Per-job key prefix; per-recipient dedupe key is composed as
     * `${dedupeKeyPrefix}:${recipientId}`. Retries of a broadcast job
     * therefore land on the same INSERT conflict per recipient and skip.
     */
    dedupeKeyPrefix?: string;
  }): Promise<void> {
    // Batch insert notifications with optional dedupe.
    const recipients = params.recipientIds.filter(id => id !== params.senderId);
    if (params.dedupeKeyPrefix) {
      // Per-recipient dedupe via INSERT ... ON CONFLICT DO NOTHING. Can't
      // use TypeORM's batch save here because we need the conflict clause.
      const values = recipients
        .map((_id, i) => {
          const off = i * 9;
          return `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}::jsonb, $${off + 7}::jsonb, $${off + 8})`;
        })
        .join(',');
      // Chunk to avoid blowing the parameter limit (PG max ~65k).
      const CHUNK = 100;
      for (let i = 0; i < recipients.length; i += CHUNK) {
        const slice = recipients.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const flatParams: any[] = [];
        const placeholders: string[] = [];
        slice.forEach((recipientId, j) => {
          const base = j * 8;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, $${base + 8})`,
          );
          flatParams.push(
            recipientId,
            params.senderId ?? null,
            params.tenantId,
            params.type,
            params.title,
            params.body,
            JSON.stringify(params.data ?? {}),
            `${params.dedupeKeyPrefix}:${recipientId}`,
          );
        });
        await this.dataSource.query(
          `INSERT INTO public.notifications
             (recipient_id, sender_id, tenant_id, type, title, body, data, dedupe_key)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          flatParams,
        );
      }
    } else {
      // Legacy path — no dedupe key.
      const notifications = recipients.map(recipientId =>
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
      for (let i = 0; i < notifications.length; i += 100) {
        await this.dataSource.manager.save(Notification, notifications.slice(i, i + 100));
      }
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
