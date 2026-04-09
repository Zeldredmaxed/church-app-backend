import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'member_badges' })
export class MemberBadge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'badge_id' })
  badgeId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'timestamptz', name: 'awarded_at', default: () => 'now()' })
  awardedAt: Date;

  @Column({ type: 'uuid', nullable: true, name: 'awarded_by' })
  awardedBy: string | null;

  @Column({ type: 'text', nullable: true, name: 'awarded_reason' })
  awardedReason: string | null;
}
