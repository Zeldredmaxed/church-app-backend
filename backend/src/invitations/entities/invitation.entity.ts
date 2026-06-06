import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/** Maps to public.invitations. */
@Entity({ schema: 'public', name: 'invitations' })
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** UUID of the admin/pastor who sent the invitation. */
  @Column({ type: 'uuid', name: 'invited_by' })
  invitedBy: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  role: 'admin' | 'pastor' | 'member';

  /**
   * Cryptographically secure random hex token (64 chars).
   * In production: delivered ONLY via email, never in API response bodies.
   * In development: returned in the response until the email service is integrated.
   */
  @Column({ type: 'text', unique: true })
  token: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  /** NULL = pending. Set to NOW() when the invitee accepts. */
  @Column({ type: 'timestamptz', nullable: true, name: 'accepted_at' })
  acceptedAt: Date | null;

  /**
   * Migration 100: NULL = active. Set to NOW() when an admin cancels
   * the invitation via DELETE /api/invitations/:id. Cancelled invites
   * are kept (not hard-deleted) for audit history; the accept flow
   * gates on cancelled_at IS NULL.
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
