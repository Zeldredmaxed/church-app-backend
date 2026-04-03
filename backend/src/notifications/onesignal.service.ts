import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OneSignal from '@onesignal/node-onesignal';

/**
 * OneSignal push notification service.
 *
 * Wraps the OneSignal REST API v2 client. Users are identified by their
 * Supabase user UUID as the OneSignal `external_id` (set when the mobile
 * app registers the device token).
 *
 * This service is injected into the NotificationsProcessor (BullMQ worker)
 * to send push notifications as a side-effect of processing notification jobs.
 */
@Injectable()
export class OneSignalService {
  private readonly logger = new Logger(OneSignalService.name);
  private readonly client: OneSignal.DefaultApi;
  private readonly appId: string;

  constructor(private readonly config: ConfigService) {
    this.appId = this.config.getOrThrow<string>('ONESIGNAL_APP_ID');
    const restApiKey = this.config.getOrThrow<string>('ONESIGNAL_REST_API_KEY');

    const configuration = OneSignal.createConfiguration({
      restApiKey,
    });

    this.client = new OneSignal.DefaultApi(configuration);
  }

  /**
   * Sends a push notification to a specific user via their external_id.
   *
   * OneSignal maps external_id → device tokens automatically.
   * If the user has no registered devices, OneSignal silently ignores the request.
   *
   * @param externalUserId - The user's UUID (same as Supabase auth.users.id)
   * @param heading - Notification title
   * @param content - Notification body text
   * @param data - Optional key-value data payload (for deep linking in the app)
   */
  async sendPush(
    externalUserId: string,
    heading: string,
    content: string,
    data?: Record<string, string>,
  ): Promise<void> {
    try {
      const notification = new OneSignal.Notification();
      notification.app_id = this.appId;
      notification.include_aliases = {
        external_id: [externalUserId],
      };
      notification.target_channel = 'push';
      notification.headings = { en: heading };
      notification.contents = { en: content };

      if (data) {
        notification.data = data;
      }

      const response = await this.client.createNotification(notification);
      this.logger.log(
        `Push sent to user ${externalUserId}: ${response.id ?? 'queued'}`,
      );
    } catch (err: any) {
      // Log but don't throw — push failures should not block notification processing.
      // Common reasons: user has no devices registered, OneSignal rate limit, network error.
      this.logger.error(
        `Failed to send push to user ${externalUserId}: ${err.message}`,
      );
    }
  }
}
