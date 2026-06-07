import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ schema: 'public', name: 'groups' })
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true, name: 'image_url' })
  imageUrl: string | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'created_by' })
  creator?: User;

  /**
   * Migration 097: linked tag. Adding a member to the group
   * auto-assigns this tag; removing a member auto-removes it.
   * NULL = no tag link (admin hasn't set one).
   */
  @Column({ type: 'uuid', nullable: true, name: 'auto_tag_id' })
  autoTagId: string | null;

  /** Migration 103: 0=Sun, 1=Mon, ..., 6=Sat. NULL if no fixed weekday. */
  @Column({ type: 'smallint', nullable: true, name: 'meeting_day_of_week' })
  meetingDayOfWeek: number | null;

  /** Migration 103: meeting start time as 'HH:MM:SS' (TIME column). */
  @Column({ type: 'time', nullable: true, name: 'meeting_time_start' })
  meetingTimeStart: string | null;

  /** Migration 103: weekly | biweekly | monthly | NULL. */
  @Column({ type: 'text', nullable: true, name: 'meeting_frequency' })
  meetingFrequency: 'weekly' | 'biweekly' | 'monthly' | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
