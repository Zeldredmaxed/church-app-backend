import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.notifications.
 * In-app notifications — one row per recipient per event.
 * tenant_id is denormalised for RLS performance (same pattern as comments).
 *
 * Notifications are INSERT-ed by the BullMQ processor using a service-role
 * connection (bypasses RLS). Users can only SELECT/UPDATE their own rows
 * via RLS policies.
 */
@Entity({ schema: 'public', name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The user who receives the notification. */
  @Column({ type: 'uuid', name: 'recipient_id' })
  recipientId: string;

  /** Denormalised tenant context for RLS. */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Notification type: NEW_COMMENT, POST_MENTION, INVITATION_ACCEPTED, etc. */
  @Column({ type: 'text' })
  type: string;

  /** Structured payload — varies by notification type. */
  @Column({ type: 'jsonb', default: '{}' })
  payload: Record<string, unknown>;

  /** NULL = unread. Set to a timestamp when the user marks it as read. */
  @Column({ type: 'timestamptz', nullable: true, name: 'read_at' })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
