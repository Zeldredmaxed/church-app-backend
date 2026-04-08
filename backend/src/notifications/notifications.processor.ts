import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { Notification } from './entities/notification.entity';
import { OneSignalService } from './onesignal.service';
import {
  NotificationJobData,
  NotificationType,
  NewCommentJob,
  PostMentionJob,
  NewGlobalPostJob,
  InvitationEmailJob,
  NewMessageJob,
} from './notifications.types';

/**
 * BullMQ processor for the 'notifications' queue.
 *
 * Runs outside the HTTP request lifecycle — uses a service-role DataSource
 * connection (bypasses RLS). This is correct because:
 *   1. Notification INSERTs are system-generated, not user-initiated.
 *   2. There is no RLS INSERT policy on notifications for the 'authenticated'
 *      role — only the service role can create rows.
 *   3. The job payload is trusted (dispatched by verified backend services).
 *
 * Each handler:
 *   1. Creates an in-app notification row (if applicable)
 *   2. Sends a push notification via OneSignal
 */
@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly oneSignal: OneSignalService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    this.logger.log(`Processing job ${job.id}: ${job.data.type}`);

    switch (job.data.type) {
      case NotificationType.NEW_COMMENT:
        await this.handleNewComment(job.data);
        break;
      case NotificationType.POST_MENTION:
        await this.handlePostMention(job.data);
        break;
      case NotificationType.NEW_GLOBAL_POST:
        await this.handleNewGlobalPost(job.data);
        break;
      case NotificationType.INVITATION_EMAIL:
        await this.handleInvitationEmail(job.data);
        break;
      case NotificationType.NEW_MESSAGE:
        await this.handleNewMessage(job.data);
        break;
      default:
        this.logger.warn(`Unknown notification type: ${(job.data as NotificationJobData).type}`);
    }
  }

  /**
   * Creates an in-app notification for the post author when someone comments.
   * Sends a push notification via OneSignal.
   * Skips if the commenter IS the post author (no self-notification).
   */
  private async handleNewComment(data: NewCommentJob): Promise<void> {
    if (data.recipientUserId === data.actorUserId) {
      this.logger.log('Skipping self-notification for comment on own post');
      return;
    }

    await this.dataSource.manager.save(
      Notification,
      this.dataSource.manager.create(Notification, {
        recipientId: data.recipientUserId,
        tenantId: data.tenantId,
        type: data.type,
        payload: {
          postId: data.postId,
          commentId: data.commentId,
          actorUserId: data.actorUserId,
          preview: data.previewText,
        },
      }),
    );

    this.logger.log(
      `In-app notification created for user ${data.recipientUserId} (new comment on post ${data.postId})`,
    );

    await this.oneSignal.sendPush(
      data.recipientUserId,
      'New Comment',
      data.previewText,
      { type: 'NEW_COMMENT', postId: data.postId },
    );
  }

  /**
   * Creates an in-app notification for each mentioned user.
   * Sends a push notification via OneSignal.
   * Skips if the mentioned user is the post author (no self-notification).
   */
  private async handlePostMention(data: PostMentionJob): Promise<void> {
    if (data.recipientUserId === data.actorUserId) {
      this.logger.log('Skipping self-notification for self-mention');
      return;
    }

    await this.dataSource.manager.save(
      Notification,
      this.dataSource.manager.create(Notification, {
        recipientId: data.recipientUserId,
        tenantId: data.tenantId,
        type: data.type,
        payload: {
          postId: data.postId,
          actorUserId: data.actorUserId,
          preview: data.previewText,
        },
      }),
    );

    this.logger.log(
      `In-app notification created for user ${data.recipientUserId} (mentioned in post ${data.postId})`,
    );

    await this.oneSignal.sendPush(
      data.recipientUserId,
      'You were mentioned',
      data.previewText,
      { type: 'POST_MENTION', postId: data.postId },
    );
  }

  /**
   * Creates an in-app notification for a follower when someone they follow
   * creates a global post. Sends a push notification via OneSignal.
   */
  private async handleNewGlobalPost(data: NewGlobalPostJob): Promise<void> {
    if (data.recipientUserId === data.actorUserId) {
      return;
    }

    await this.dataSource.manager.save(
      Notification,
      this.dataSource.manager.create(Notification, {
        recipientId: data.recipientUserId,
        tenantId: data.tenantId,
        type: data.type,
        payload: {
          postId: data.postId,
          actorUserId: data.actorUserId,
          preview: data.previewText,
        },
      }),
    );

    this.logger.log(
      `In-app notification created for user ${data.recipientUserId} (new global post ${data.postId})`,
    );

    await this.oneSignal.sendPush(
      data.recipientUserId,
      'New Post',
      data.previewText,
      { type: 'NEW_GLOBAL_POST', postId: data.postId },
    );
  }

  /**
   * Sends an invitation email via the email service.
   * Phase 1: logs the email details. Phase 2: integrates Resend SDK.
   * No push notification — the recipient may not have the app installed yet.
   */
  private async handleInvitationEmail(data: InvitationEmailJob): Promise<void> {
    // TODO: Replace with actual email sending via Resend SDK
    this.logger.log(
      `[EMAIL STUB] Invitation email would be sent to ${data.recipientEmail} ` +
        `with token ${data.invitationToken.slice(0, 8)}... (role: ${data.role}, expires: ${data.expiresAt})`,
    );
  }

  /**
   * Creates an in-app notification and sends a push for new messages
   * in private/direct channels. The ChatService only dispatches these
   * for non-public channels to avoid notification spam.
   */
  private async handleNewMessage(data: NewMessageJob): Promise<void> {
    if (data.recipientUserId === data.actorUserId) {
      this.logger.log('Skipping self-notification for own message');
      return;
    }

    await this.dataSource.manager.save(
      Notification,
      this.dataSource.manager.create(Notification, {
        recipientId: data.recipientUserId,
        tenantId: data.tenantId,
        type: data.type,
        payload: {
          channelId: data.channelId,
          channelName: data.channelName,
          actorUserId: data.actorUserId,
          preview: data.previewText,
        },
      }),
    );

    this.logger.log(
      `In-app notification created for user ${data.recipientUserId} (new message in ${data.channelName})`,
    );

    await this.oneSignal.sendPush(
      data.recipientUserId,
      data.channelName,
      data.previewText,
      { type: 'NEW_MESSAGE', channelId: data.channelId },
    );
  }
}
