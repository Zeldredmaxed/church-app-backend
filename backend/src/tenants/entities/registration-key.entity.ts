import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.registration_keys.
 * Pre-generated invite codes that churches use for self-service registration.
 * Each key maps to a tier and can only be claimed once.
 */
@Entity({ schema: 'public', name: 'registration_keys' })
export class RegistrationKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  key: string;

  @Column({ type: 'text', default: 'standard' })
  tier: 'standard' | 'premium' | 'enterprise';

  @Column({ type: 'uuid', nullable: true, name: 'claimed_by' })
  claimedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'claimed_at' })
  claimedAt: Date | null;
}
