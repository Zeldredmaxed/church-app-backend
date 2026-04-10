import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'family_connections' })
export class FamilyConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** The person whose "tree" this row lives on */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** The family member being connected */
  @Column({ type: 'uuid', name: 'related_user_id' })
  relatedUserId: string;

  /** Category enum: spouse, child, parent, sibling, … */
  @Column({ type: 'text' })
  relationship: string;

  /** Human-readable: "Wife", "Mother-in-Law", etc. */
  @Column({ type: 'varchar', length: 50, name: 'relationship_label' })
  relationshipLabel: string;

  /** pending | accepted | declined */
  @Column({ type: 'text', default: 'pending' })
  status: string;

  /** True for auto-created in-law / sibling links */
  @Column({ type: 'boolean', name: 'is_inferred', default: false })
  isInferred: boolean;

  /** Points to the connection that triggered this inference */
  @Column({ type: 'uuid', name: 'inferred_via', nullable: true })
  inferredVia: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt: Date | null;
}
