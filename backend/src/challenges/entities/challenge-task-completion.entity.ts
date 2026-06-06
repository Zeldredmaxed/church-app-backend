import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.challenge_task_completions — one row per (enrollment,
 * task). Carries the reflection text + timer evidence the member
 * submitted on completion. Schema owned by
 * migrations/096_challenges_reading_plans.sql.
 */
@Entity({ schema: 'public', name: 'challenge_task_completions' })
export class ChallengeTaskCompletion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'enrollment_id' })
  enrollmentId: string;

  @Column({ type: 'uuid', name: 'task_id' })
  taskId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'date', name: 'completed_on' })
  completedOn: string;

  @Column({ type: 'text', name: 'reflection_text', nullable: true })
  reflectionText: string | null;

  @Column({ type: 'int', name: 'seconds_spent', nullable: true })
  secondsSpent: number | null;

  @Column({ type: 'boolean', name: 'timer_satisfied', default: true })
  timerSatisfied: boolean;

  /** Migration 098: completed past the task's anchored day. Late completions are accepted but score 0 points. */
  @Column({ type: 'boolean', name: 'is_late', default: false })
  isLate: boolean;

  /** Migration 098: 0-100 by tenant-local hour of completion. 0 if isLate. */
  @Column({ type: 'int', name: 'points_earned', default: 0 })
  pointsEarned: number;

  @CreateDateColumn({ name: 'completed_at' })
  completedAt: Date;
}
