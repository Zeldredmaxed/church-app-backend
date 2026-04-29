/**
 * Notification job types dispatched to the BullMQ 'notifications' queue.
 * Each type has a corresponding payload shape.
 */
export enum NotificationType {
  NEW_COMMENT = 'NEW_COMMENT',
  POST_MENTION = 'POST_MENTION',
  NEW_GLOBAL_POST = 'NEW_GLOBAL_POST',
  INVITATION_EMAIL = 'INVITATION_EMAIL',
  NEW_MESSAGE = 'NEW_MESSAGE',
  FAMILY_REQUEST = 'family_request',
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
