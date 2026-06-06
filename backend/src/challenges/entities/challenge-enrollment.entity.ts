import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.challenge_enrollments — a member's enrollment in one
 * challenge. started_on anchors the self-paced "today" → day_index math.
 * Schema owned by migrations/096_challenges_reading_plans.sql.
 */
@Entity({ schema: 'public', name: 'challenge_enrollments' })
export class ChallengeEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'challenge_id' })
  challengeId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'date', name: 'started_on' })
  startedOn: string;

  @Column({ type: 'text', default: 'active' })
  status: 'active' | 'completed' | 'abandoned';

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'int', name: 'current_streak', default: 0 })
  currentStreak: number;

  @Column({ type: 'int', name: 'longest_streak', default: 0 })
  longestStreak: number;

  @Column({ type: 'date', name: 'last_completed_date', nullable: true })
  lastCompletedDate: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
