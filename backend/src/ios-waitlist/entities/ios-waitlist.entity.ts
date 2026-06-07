import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.ios_waitlist (migration 106). Platform-level — no
 * tenant scoping. Captured via the install landing page on iOS user
 * agents until the iOS app launches on TestFlight.
 */
@Entity({ schema: 'public', name: 'ios_waitlist' })
export class IosWaitlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text', nullable: true })
  source: string | null;

  @Column({ type: 'jsonb', name: 'device_info', default: () => "'{}'" })
  deviceInfo: Record<string, any>;

  @Column({ type: 'inet', name: 'ip_address', nullable: true })
  ipAddress: string | null;

  /** NULL = on waitlist, not yet invited. Stamped when exported to TestFlight. */
  @Column({ type: 'timestamptz', name: 'invited_at', nullable: true })
  invitedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
