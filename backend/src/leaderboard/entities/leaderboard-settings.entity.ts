import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'leaderboard_settings' })
export class LeaderboardSettings {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'boolean', default: true })
  visible: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
