import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.tenants — one row per church / organisation.
 * Schema is owned by migrations/001_initial_schema_and_rls.sql.
 * TypeORM synchronize is DISABLED — never let TypeORM alter this table.
 */
@Entity({ schema: 'public', name: 'tenants' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true, name: 'stripe_account_id' })
  stripeAccountId: string | null;

  /** Stripe Connect onboarding status: pending, onboarding, active, restricted. */
  @Column({ type: 'text', name: 'stripe_account_status', default: 'pending' })
  stripeAccountStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
