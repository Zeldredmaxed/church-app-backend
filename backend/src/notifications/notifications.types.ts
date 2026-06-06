/**
 * Notification job types dispatched to the BullMQ 'notifications' queue.
 * Each type has a corresponding payload shape.
 *
 * IMPORTANT: keep this enum in sync with NOTIFICATION_CATEGORIES below.
 * The mobile preferences screen reads the categories endpoint to render
 * its toggle list; any new type added to the processor MUST also be
 * registered as a category here.
 */
export enum NotificationType {
  // Social
  POST_LIKE = 'post_like',
  NEW_COMMENT = 'post_comment',
  COMMENT_REPLY = 'comment_reply',
  POST_MENTION = 'post_mention',
  NEW_FOLLOWER = 'new_follower',
  NEW_GLOBAL_POST = 'new_global_post',
  // Chat
  NEW_MESSAGE = 'new_message',
  GROUP_MESSAGE = 'group_message',
  // Church
  NEW_SERMON = 'new_sermon',
  NEW_ANNOUNCEMENT = 'new_announcement',
  NEW_EVENT = 'new_event',
  EVENT_REMINDER = 'event_reminder',
  EVENT_CANCELLED = 'event_cancelled',
  // Prayer
  PRAYER_PRAYED = 'prayer_prayed',
  PRAYER_ANSWERED = 'prayer_answered',
  // Giving & fundraising
  DONATION_RECEIVED = 'donation_received',
  FUNDRAISER_GOAL = 'fundraiser_goal',
  GIVING_RECEIPT = 'giving_receipt',
  // Groups
  GROUP_INVITE = 'group_invite',
  // Admin / system
  CHURCH_BROADCAST = 'church_broadcast',
  SYSTEM_BROADCAST = 'system_broadcast',
  BADGE_EARNED = 'badge_earned',
  ROLE_CHANGED = 'role_changed',
  // Family
  FAMILY_REQUEST = 'family_request',
  FAMILY_ACCEPTED = 'family_accepted',
  // Out-of-band (no recipientUserId — handled separately)
  INVITATION_EMAIL = 'INVITATION_EMAIL',
}

/**
 * User-facing catalog. Drives the mobile preferences screen — each
 * entry surfaces a toggle. `group` is the visual section header.
 */
export const NOTIFICATION_CATEGORIES: ReadonlyArray<{
  key: string;
  label: string;
  description: string;
  group: 'Social' | 'Chat' | 'Church' | 'Prayer' | 'Giving' | 'Groups' | 'Admin' | 'Family';
  defaultPush: boolean;
  defaultEmail: boolean;
  defaultSms: boolean;
}> = [
  { key: 'post_like', label: 'Post likes', description: 'When someone likes your post', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'post_comment', label: 'Post comments', description: 'When someone comments on your post', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'comment_reply', label: 'Comment replies', description: 'When someone replies to your comment', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'post_mention', label: 'Mentions', description: 'When someone @mentions you', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'new_follower', label: 'New follower', description: 'When someone follows you', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'new_global_post', label: 'Posts from people you follow', description: 'New global posts from people you follow', group: 'Social', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'new_message', label: 'Direct messages', description: 'New private chat messages', group: 'Chat', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'group_message', label: 'Group messages', description: 'New messages in your groups', group: 'Chat', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'new_sermon', label: 'New sermon', description: 'When your church publishes a new sermon', group: 'Church', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'new_announcement', label: 'Church announcements', description: 'New church-wide announcements', group: 'Church', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'new_event', label: 'New events', description: 'When your church schedules a new event', group: 'Church', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'event_reminder', label: 'Event reminders', description: 'Before events you RSVPed to', group: 'Church', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'event_cancelled', label: 'Event cancellations', description: 'When an event you RSVPed to is cancelled', group: 'Church', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'prayer_prayed', label: 'Someone prayed for you', description: 'When a member prays for your request', group: 'Prayer', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'prayer_answered', label: 'Prayer answered', description: 'When a prayer you supported is marked answered', group: 'Prayer', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'donation_received', label: 'Donation receipts', description: 'When your donation is received', group: 'Giving', defaultPush: true, defaultEmail: true, defaultSms: false },
  { key: 'fundraiser_goal', label: 'Fundraiser milestones', description: 'When a fundraiser you supported hits its goal', group: 'Giving', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'giving_receipt', label: 'Tax receipt', description: 'Annual tax receipt and statements', group: 'Giving', defaultPush: false, defaultEmail: true, defaultSms: false },

  { key: 'group_invite', label: 'Group invites', description: 'When you are invited to a group', group: 'Groups', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'church_broadcast', label: 'Church broadcasts', description: 'Push messages from your church admins', group: 'Admin', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'system_broadcast', label: 'Shepard updates', description: 'Platform announcements from Shepard', group: 'Admin', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'badge_earned', label: 'Badges earned', description: 'When you earn a badge', group: 'Admin', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'role_changed', label: 'Role updates', description: 'When your role in a church changes', group: 'Admin', defaultPush: true, defaultEmail: false, defaultSms: false },

  { key: 'family_request', label: 'Family connection requests', description: 'When someone requests a family connection', group: 'Family', defaultPush: true, defaultEmail: false, defaultSms: false },
  { key: 'family_accepted', label: 'Family request accepted', description: 'When someone accepts your family request', group: 'Family', defaultPush: true, defaultEmail: false, defaultSms: false },
];

/**
 * All notification types valid for preference toggling. Drives @IsIn
 * validation on UpdatePreferenceDto so admin/system-only types like
 * INVITATION_EMAIL aren't accidentally exposed in the prefs UI.
 */
export const NOTIFICATION_TYPE_KEYS: ReadonlyArray<string> = NOTIFICATION_CATEGORIES.map(c => c.key);

/** Base shape for all notification jobs. */
interface BaseNotificationJob {
  type: NotificationType;
  tenantId: string;
}

/** Dispatched when a comment is created on a post. */
export interface NewCommentJob extends BaseNotificationJob {
  type: NotificationType.NEW_COMMENT;
  recipientUserId: string;
  actorUserId: string;
  postId: string;
  commentId: string;
  previewText: string;
}

/** Dispatched when a user is mentioned in a post. */
export interface PostMentionJob extends BaseNotificationJob {
  type: NotificationType.POST_MENTION;
  recipientUserId: string;
  actorUserId: string;
  postId: string;
  previewText: string;
}

/** Dispatched to followers when a global post is created. */
export interface NewGlobalPostJob extends BaseNotificationJob {
  type: NotificationType.NEW_GLOBAL_POST;
  recipientUserId: string;
  actorUserId: string;
  postId: string;
  previewText: string;
}

/** Dispatched when an invitation is created — sends the email. */
export interface InvitationEmailJob extends BaseNotificationJob {
  type: NotificationType.INVITATION_EMAIL;
  recipientEmail: string;
  invitationToken: string;
  role: string;
  expiresAt: string;
}

/** Dispatched when a message is sent in a private or direct channel. */
export interface NewMessageJob extends BaseNotificationJob {
  type: NotificationType.NEW_MESSAGE;
  recipientUserId: string;
  actorUserId: string;
  channelId: string;
  channelName: string;
  previewText: string;
}

/** Dispatched when one user sends a family-connection request to another. */
export interface FamilyRequestJob extends BaseNotificationJob {
  type: NotificationType.FAMILY_REQUEST;
  recipientUserId: string;
  actorUserId: string;
  requestId: string;
  relationship: string;
  /** Resolved label using target's gender (e.g. "father" not "parent"). */
  relationshipLabel: string;
}

export type NotificationJobData =
  | NewCommentJob
  | PostMentionJob
  | NewGlobalPostJob
  | InvitationEmailJob
  | NewMessageJob
  | FamilyRequestJob;
