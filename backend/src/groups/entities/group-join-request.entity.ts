import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type JoinRequestStatus = 'pending' | 'approved' | 'denied';

@Entity({ schema: 'public', name: 'group_join_requests' })
export class GroupJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text', default: 'pending' })
  status: JoinRequestStatus;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'reviewed_at' })
  reviewedAt: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'reviewed_by' })
  reviewedBy: string | null;

  @Column({ type: 'text', nullable: true, name: 'denied_reason' })
  deniedReason: string | null;
}
