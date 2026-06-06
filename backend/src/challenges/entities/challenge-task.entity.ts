import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.challenge_tasks — a single daily task inside a
 * challenge. Three task_types: 'scripture' (timer-gated read),
 * 'reflection' (prompt + free-text), 'checkin' (single confirm).
 * Schema owned by migrations/096_challenges_reading_plans.sql.
 */
@Entity({ schema: 'public', name: 'challenge_tasks' })
export class ChallengeTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'challenge_id' })
  challengeId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int', name: 'day_index' })
  dayIndex: number;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'text', name: 'task_type' })
  taskType: 'scripture' | 'reflection' | 'checkin';

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'scripture_reference', nullable: true })
  scriptureReference: string | null;

  @Column({ type: 'text', name: 'scripture_translation', nullable: true })
  scriptureTranslation: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'int', name: 'timer_seconds', nullable: true })
  timerSeconds: number | null;

  @Column({ type: 'text', name: 'reflection_prompt', nullable: true })
  reflectionPrompt: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
