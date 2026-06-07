import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Maps to public.feedback. Pile of bug reports + feature requests +
 * workflow-node requests from mobile + admin. Triaged manually for
 * now via the /feedback/triage endpoints; future Paperclip
 * "Triage Officer" agent automates the classification step.
 *
 * Migrations: 088 (base) + 104 (screenshots + triage workflow).
 */
@Entity({ schema: 'public', name: 'feedback' })
export class Feedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  type: 'node_request' | 'bug_report' | 'feature_request';

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  description: string;

  /** Migration 104: 'critical' added to the existing low|medium|high set. */
  @Column({ type: 'text', default: 'medium' })
  priority: 'low' | 'medium' | 'high' | 'critical';

  @Column({ type: 'text', default: 'open' })
  status: 'open' | 'in_progress' | 'completed' | 'closed';

  @Column({ type: 'uuid', name: 'submitted_by' })
  submittedBy: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /**
   * Migration 104: array of S3 URLs from the existing /api/media
   * presigned-upload flow. Mobile uploads to S3 first (existing
   * code), then passes the resulting URLs here.
   */
  @Column({ type: 'text', array: true, name: 'screenshot_urls', default: () => "'{}'" })
  screenshotUrls: string[];

  /**
   * Migration 104: free-form context for reproduction. Mobile sends:
   *   { platform, osVersion, appVersion, route, buildNumber? }
   */
  @Column({ type: 'jsonb', name: 'device_info', default: () => "'{}'" })
  deviceInfo: Record<string, any>;

  /**
   * Migration 104: classified during triage. NULL = not yet triaged.
   * 'frontend' / 'backend' / 'admin' route to the matching
   * engineering surface; 'unknown' means triaged but not classifiable.
   */
  @Column({ type: 'text', nullable: true })
  category: 'frontend' | 'backend' | 'admin' | 'unknown' | null;

  /** Migration 104: timestamp the item was triaged. NULL = not yet. */
  @Column({ type: 'timestamptz', name: 'triaged_at', nullable: true })
  triagedAt: Date | null;

  /** Migration 104: user_id of the triager. */
  @Column({ type: 'uuid', name: 'triaged_by', nullable: true })
  triagedBy: string | null;

  /** Migration 104: free-text triage notes ("Repro: tap Settings, then..."). */
  @Column({ type: 'text', name: 'triage_notes', nullable: true })
  triageNotes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
