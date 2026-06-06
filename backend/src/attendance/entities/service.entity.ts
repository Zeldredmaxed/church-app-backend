import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * One row per recurring service slot (e.g. "Sunday 9am", "Sunday 11am",
 * "Wednesday 7pm"). Geo-attendance fields (latitude / longitude /
 * radius_meters / threshold minutes) added by migration 080 — they
 * extend the original migration-017 services table.
 */
@Entity({ schema: 'public', name: 'services' })
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Display label (e.g. "Sunday Worship"). Stored in the legacy `name` column. */
  @Column({ type: 'text' })
  name: string;

  /** 0 = Sunday … 6 = Saturday. Matches Postgres EXTRACT(DOW FROM ...). */
  @Column({ type: 'integer', name: 'day_of_week' })
  dayOfWeek: number;

  /** Local time the service starts (tenant's IANA timezone). */
  @Column({ type: 'time', name: 'start_time' })
  startTime: string;

  /** Local time the service ends. NULL on legacy rows pre-migration-080. */
  @Column({ type: 'time', nullable: true, name: 'end_time' })
  endTime: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  /** Geofence radius. 50–5000m enforced by CHECK constraint. */
  @Column({ type: 'integer', nullable: true, name: 'radius_meters' })
  radiusMeters: number | null;

  /** Minutes past start_time after which a first ping is flagged "late". */
  @Column({ type: 'integer', name: 'late_threshold_minutes', default: 15 })
  lateThresholdMinutes: number;

  /** Minutes before end_time before which a last ping is flagged "left early". */
  @Column({ type: 'integer', name: 'early_leave_threshold_minutes', default: 15 })
  earlyLeaveThresholdMinutes: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** When false, the start-push cron skips this service. Members still get
   * marked present if they happen to ping in radius during the window. */
  @Column({ type: 'boolean', name: 'auto_push_enabled', default: true })
  autoPushEnabled: boolean;

  /** Free text shown on the auto-push body. NULL = use default. */
  @Column({ type: 'text', nullable: true, name: 'push_message' })
  pushMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
