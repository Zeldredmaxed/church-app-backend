import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.tenants — one row per church / organisation.
 * Schema is owned by migrations/001_initial_schema_and_rls.sql.
 * Extended by migrations/012_church_registration_tiers_permissions.sql.
 * TypeORM synchronize is DISABLED — never let TypeORM alter this table.
 */
@Entity({ schema: 'public', name: 'tenants' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  /** URL-friendly church identifier (e.g., "grace-church"). Set during registration. */
  @Column({ type: 'text', nullable: true, unique: true })
  slug: string | null;

  /** Subscription tier: standard, premium, enterprise. */
  @Column({ type: 'text', default: 'standard' })
  tier: 'standard' | 'premium' | 'enterprise';

  /** Registration key used to create this tenant. NULL if created by super admin. */
  @Column({ type: 'text', nullable: true, unique: true, name: 'registration_key' })
  registrationKey: string | null;

  @Column({ type: 'text', nullable: true, name: 'stripe_account_id' })
  stripeAccountId: string | null;

  /** Stripe Connect onboarding status: pending, onboarding, active, restricted. */
  @Column({ type: 'text', name: 'stripe_account_status', default: 'pending' })
  stripeAccountStatus: string;

  /** When false, all members excluded from church + global leaderboards. */
  @Column({ type: 'boolean', name: 'leaderboard_enabled', default: true })
  leaderboardEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
