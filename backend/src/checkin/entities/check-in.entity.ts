import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'check_ins' })
export class CheckIn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'service_id' })
  serviceId: string | null;

  @Column({ type: 'boolean', name: 'is_visitor', default: false })
  isVisitor: boolean;

  @Column({ type: 'text', name: 'visitor_name', nullable: true })
  visitorName: string | null;

  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  @Column({ type: 'float', nullable: true, name: 'distance_meters' })
  distanceMeters: number | null;

  @Column({ type: 'text', name: 'check_in_type', default: 'manual' })
  checkInType: string;

  @CreateDateColumn({ name: 'checked_in_at' })
  checkedInAt: Date;
}
