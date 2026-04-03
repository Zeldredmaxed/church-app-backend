/**
 * Notification job types dispatched to the BullMQ 'notifications' queue.
 * Each type has a corresponding payload shape.
 */
export enum NotificationType {
  NEW_COMMENT = 'NEW_COMMENT',
  POST_MENTION = 'POST_MENTION',
  INVITATION_EMAIL = 'INVITATION_EMAIL',
  NEW_MESSAGE = 'NEW_MESSAGE',
}

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

export type NotificationJobData =
  | NewCommentJob
  | PostMentionJob
  | InvitationEmailJob
  | NewMessageJob;
