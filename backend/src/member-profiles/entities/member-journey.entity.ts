import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'member_journeys' })
export class MemberJourney {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'boolean', name: 'attended_members_class', default: false })
  attendedMembersClass: boolean;

  @Column({ type: 'date', nullable: true, name: 'members_class_date' })
  membersClassDate: string | null;

  @Column({ type: 'boolean', name: 'is_baptized', default: false })
  isBaptized: boolean;

  @Column({ type: 'date', nullable: true, name: 'baptism_date' })
  baptismDate: string | null;

  @Column({ type: 'date', nullable: true, name: 'salvation_date' })
  salvationDate: string | null;

  @Column({ type: 'text', nullable: true, name: 'discipleship_track' })
  discipleshipTrack: string | null;

  @Column({ type: 'text', array: true, default: '{}', nullable: true })
  skills: string[];

  @Column({ type: 'text', array: true, default: '{}', nullable: true })
  interests: string[];

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
