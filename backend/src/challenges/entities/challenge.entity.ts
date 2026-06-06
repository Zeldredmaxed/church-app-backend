import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.challenges — a multi-day reading plan / challenge a
 * pastor authors. Schema owned by migrations/096_challenges_reading_plans.sql.
 * synchronize is disabled.
 */
@Entity({ schema: 'public', name: 'challenges' })
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', name: 'cover_image_url', nullable: true })
  coverImageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ type: 'int', name: 'duration_days', default: 1 })
  durationDays: number;

  /** NULL = self-paced; a date = fixed cohort start. */
  @Column({ type: 'date', name: 'starts_on', nullable: true })
  startsOn: string | null;

  @Column({ type: 'boolean', name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
