import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'login_streaks' })
export class LoginStreak {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'int', name: 'current_streak', default: 1 })
  currentStreak: number;

  @Column({ type: 'int', name: 'longest_streak', default: 1 })
  longestStreak: number;

  @Column({ type: 'date', name: 'last_login_date' })
  lastLoginDate: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
