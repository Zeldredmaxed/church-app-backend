import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'admin_audit_log' })
export class AuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'actor_user_id' })
  actorUserId: string;

  /** Actor's role at the moment of action — preserved as a snapshot. */
  @Column({ type: 'text', name: 'actor_role' })
  actorRole: string;

  /** Dotted key, e.g. 'member.blocked', 'tag.created'. */
  @Column({ type: 'text' })
  action: string;

  @Column({ type: 'text', nullable: true, name: 'resource_type' })
  resourceType: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'resource_id' })
  resourceId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'target_user_id' })
  targetUserId: string | null;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({ type: 'inet', nullable: true, name: 'ip_address' })
  ipAddress: string | null;

  @Column({ type: 'text', nullable: true, name: 'user_agent' })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
