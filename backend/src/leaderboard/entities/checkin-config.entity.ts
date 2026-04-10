import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'checkin_config' })
export class CheckinConfig {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'int', name: 'day_of_week', default: 0 })
  dayOfWeek: number;

  @Column({ type: 'time', name: 'start_time', default: '09:00' })
  startTime: string;

  @Column({ type: 'time', name: 'end_time', default: '12:00' })
  endTime: string;

  @Column({ type: 'float', default: 0 })
  latitude: number;

  @Column({ type: 'float', default: 0 })
  longitude: number;

  @Column({ type: 'int', name: 'radius_meters', default: 800 })
  radiusMeters: number;

  @Column({ type: 'text', name: 'push_message', default: 'Good morning! Tap to check in to today\'s service.' })
  pushMessage: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
