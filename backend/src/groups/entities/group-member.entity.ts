import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'group_members' })
export class GroupMember {
  @PrimaryColumn('uuid', { name: 'group_id' })
  groupId: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;
}
