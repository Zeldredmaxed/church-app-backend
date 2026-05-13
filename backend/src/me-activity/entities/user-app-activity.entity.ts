import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Per-user, per-day app activity. Upserted by POST /api/me/activity/heartbeat.
 * One row per (user_id, date). minutes_total accrues from the heartbeat
 * deltaSeconds (capped server-side at 90s/request). session_count increments
 * on heartbeats flagged isNewSession.
 */
@Entity({ schema: 'public', name: 'user_app_activity' })
export class UserAppActivity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ type: 'int', name: 'minutes_total', default: 0 })
  minutesTotal: number;

  @Column({ type: 'int', name: 'session_count', default: 0 })
  sessionCount: number;

  @Column({ type: 'timestamptz', name: 'first_open_at' })
  firstOpenAt: Date;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt: Date;
}
