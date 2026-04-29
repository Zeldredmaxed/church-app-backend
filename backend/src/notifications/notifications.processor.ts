import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { ExpoPushService } from './expo-push.service';
import { NotificationJobData } from './notifications.types';

/**
 * BullMQ processor for the 'notifications' queue.
 *
 * Runs outside the HTTP request lifecycle — uses a service-role DataSource
 * connection (bypasses RLS). This is correct because:
 *   1. Notification INSERTs are system-generated, not user-initiated.
 *   2. The job payload is trusted (dispatched by verified backend services).
 *
 * Each handler creates an in-app notification row and sends push via Expo.
 */
@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly expo: ExpoPushService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    this.logger.log(`Processing job ${job.id}: ${job.data.type}`);
    const data = job.data;

    // Generic handler: every notification type flows through expo.send()
    // which handles in-app row creation + push delivery + preference checks.
    if ('recipientUserId' in data && data.recipientUserId) {
      await this.handleSingleRecipient(data);
    } else if ('recipientIds' in data && (data as any).recipientIds) {
      await this.handleBulkRecipients(data as any);
    } else if (data.type === 'INVITATION_EMAIL') {
      // Email-only notification — no push
      this.logger.log(
        `[EMAIL STUB] Invitation email to ${(data as any).recipientEmail} ` +
        `(role: ${(data as any).role})`,
      );
    } else {
      this.logger.warn(`Unhandled notification job: ${data.type}`);
    }
  }

  private async handleSingleRecipient(data: any): Promise<void> {
    // Resolve sender name for the title
    let senderName = 'Someone';
    if (data.actorUserId) {
      const [sender] = await this.dataSource.query(
        `SELECT full_name FROM public.users WHERE id = $1`,
        [data.actorUserId],
      );
      senderName = sender?.full_name ?? 'Someone';
    }

    const { title, body, deepLink } = this.buildNotificationContent(data, senderName);

    await this.expo.send({
      recipientId: data.recipientUserId,
      senderId: data.actorUserId,
      tenantId: data.tenantId,
      type: data.type,
      title,
      body,
      data: deepLink,
    });
  }

  private async handleBulkRecipients(data: any): Promise<void> {
    let senderName = '';
    if (data.actorUserId) {
      const [sender] = await this.dataSource.query(
        `SELECT full_name FROM public.users WHERE id = $1`,
        [data.actorUserId],
      );
      senderName = sender?.full_name ?? '';
    }

    const { title, body, deepLink } = this.buildNotificationContent(data, senderName);

    await this.expo.sendBulk({
      recipientIds: data.recipientIds,
      senderId: data.actorUserId,
      tenantId: data.tenantId,
      type: data.type,
      title,
      body,
      data: deepLink,
    });
  }

  /**
   * Build notification title, body, and deep link data based on type.
   */
  private buildNotificationContent(data: any, senderName: string): {
    title: string;
    body: string;
    deepLink: Record<string, any>;
  } {
    const preview = data.previewText ?? '';

    switch (data.type) {
      // Social
      case 'post_like':
      case 'POST_LIKE':
        return {
          title: `${senderName} liked your post`,
          body: preview.slice(0, 50),
          deepLink: { screen: 'Comments', params: { postId: data.postId } },
        };

      case 'post_comment':
      case 'NEW_COMMENT':
        return {
          title: `${senderName} commented on your post`,
          body: preview.slice(0, 50),
          deepLink: { screen: 'Comments', params: { postId: data.postId } },
        };

      case 'comment_reply':
        return {
          title: `${senderName} replied to your comment`,
          body: preview.slice(0, 50),
          deepLink: { screen: 'Comments', params: { postId: data.postId } },
        };

      case 'post_mention':
      case 'POST_MENTION':
        return {
          title: `${senderName} mentioned you in a post`,
          body: preview.slice(0, 50),
          deepLink: { screen: 'Comments', params: { postId: data.postId } },
        };

      // Follow
      case 'new_follower':
        return {
          title: `${senderName} started following you`,
          body: 'Tap to view their profile',
          deepLink: { screen: 'UserProfile', params: { userId: data.actorUserId } },
        };

      // Messages
      case 'new_message':
      case 'NEW_MESSAGE':
        return {
          title: senderName,
          body: preview.slice(0, 80),
          deepLink: { screen: 'Conversation', params: { userId: data.actorUserId } },
        };

      case 'group_message':
        return {
          title: data.channelName ?? 'Group Chat',
          body: `${senderName}: ${preview.slice(0, 60)}`,
          deepLink: { screen: 'GroupChat', params: { groupId: data.groupId ?? data.channelId } },
        };

      // Church content
      case 'new_sermon':
        return {
          title: `New Sermon: "${data.sermonTitle ?? preview}"`,
          body: `By ${data.speaker ?? senderName} — available now`,
          deepLink: { screen: 'SermonPlayer', params: { sermonId: data.sermonId } },
        };

      case 'new_announcement':
        return {
          title: `${data.churchName ?? 'Church'} Announcement`,
          body: preview.slice(0, 100),
          deepLink: { screen: 'Announcements' },
        };

      case 'new_event':
        return {
          title: `New Event: "${data.eventTitle ?? preview}"`,
          body: `${data.eventDate ?? ''} — RSVP now`,
          deepLink: { screen: 'EventDetail', params: { eventId: data.eventId } },
        };

      case 'event_reminder':
        return {
          title: `Event Reminder: "${data.eventTitle ?? ''}"`,
          body: `Starting in ${data.timeUntil ?? 'soon'}`,
          deepLink: { screen: 'EventDetail', params: { eventId: data.eventId } },
        };

      // Prayer
      case 'prayer_prayed':
        return {
          title: `${senderName} prayed for your request`,
          body: preview.slice(0, 50),
          deepLink: { screen: 'PrayerWall' },
        };

      case 'prayer_answered':
        return {
          title: 'Prayer Answered!',
          body: preview.slice(0, 50),
          deepLink: { screen: 'PrayerWall' },
        };

      // Giving & Fundraising
      case 'donation_received':
        return {
          title: `${data.anonymous ? 'Someone' : senderName} donated ${data.formattedAmount ?? ''}`,
          body: `to "${data.fundraiserTitle ?? ''}"`,
          deepLink: { screen: 'FundraiserDetail', params: { fundraiserId: data.fundraiserId } },
        };

      case 'fundraiser_goal':
        return {
          title: 'Goal Reached!',
          body: `"${data.fundraiserTitle}" hit its target`,
          deepLink: { screen: 'FundraiserDetail', params: { fundraiserId: data.fundraiserId } },
        };

      case 'giving_receipt':
        return {
          title: 'Donation Receipt',
          body: `Your ${data.formattedAmount ?? ''} gift has been processed`,
          deepLink: { screen: 'GivingHistory' },
        };

      // Groups
      case 'group_invite':
        return {
          title: `You've been invited to "${data.groupName ?? ''}"`,
          body: `By ${senderName}`,
          deepLink: { screen: 'GroupChat', params: { groupId: data.groupId } },
        };

      // Admin & System
      case 'church_broadcast':
      case 'system_broadcast':
        return {
          title: data.broadcastTitle ?? 'Announcement',
          body: data.broadcastBody ?? preview,
          deepLink: { screen: 'Announcements' },
        };

      case 'badge_earned':
        return {
          title: 'Badge Earned!',
          body: `You earned the "${data.badgeName ?? ''}" badge`,
          deepLink: { screen: 'Main', params: { screen: 'Profile' } },
        };

      case 'role_changed':
        return {
          title: 'Role Updated',
          body: `You are now a ${data.newRole ?? 'member'} at ${data.churchName ?? 'your church'}`,
          deepLink: { screen: 'ChurchProfile' },
        };

      case 'volunteer_reminder':
        return {
          title: 'Volunteer Reminder',
          body: `"${data.role ?? ''}" at "${data.serviceName ?? ''}" tomorrow`,
          deepLink: { screen: 'VolunteerSignup' },
        };

      case 'checkin_reminder':
        return {
          title: 'Time to Check In!',
          body: 'Service starts soon — check in now',
          deepLink: { screen: 'CheckIn' },
        };

      // Global post (legacy)
      case 'NEW_GLOBAL_POST':
        return {
          title: 'New Post',
          body: preview.slice(0, 80),
          deepLink: { screen: 'Comments', params: { postId: data.postId } },
        };

      // Family connection request
      case 'family_request':
      case 'FAMILY_REQUEST':
        return {
          title: 'Family Connection Request',
          body: `${senderName} wants to add you as their ${data.relationshipLabel ?? 'family'}`,
          deepLink: {
            screen: 'Family',
            params: { requestId: data.requestId },
            requesterId: data.actorUserId,
            relationship: data.relationship,
          },
        };

      case 'family_accepted':
        return {
          title: 'Family Connection Accepted',
          body: `${senderName} accepted your family request (${data.relationshipLabel ?? 'family'})`,
          deepLink: {
            screen: 'Family',
            params: { connectionId: data.connectionId },
            relationship: data.relationship,
          },
        };

      default:
        return {
          title: 'Notification',
          body: preview || 'You have a new notification',
          deepLink: { screen: 'Feed' },
        };
    }
  }
}
