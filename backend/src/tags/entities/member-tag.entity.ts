import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'member_tags' })
export class MemberTag {
  @PrimaryColumn('uuid', { name: 'tag_id' })
  tagId: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'assigned_by' })
  assignedBy: string;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt: Date;
}
