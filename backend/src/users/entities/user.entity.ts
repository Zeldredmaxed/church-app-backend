import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.users.
 * id is NOT auto-generated — it is set to the Supabase auth.users UUID
 * by the handle_new_user trigger. TypeORM should never insert into this table
 * directly; use the Supabase Auth client for user creation.
 *
 * Schema changes: migrations/001_initial_schema_and_rls.sql (base)
 *                 migrations/002_add_user_profile_fields.sql (full_name, avatar_url)
 */
@Entity({ schema: 'public', name: 'users' })
export class User {
  /** Links 1:1 to auth.users.id — populated by the handle_new_user DB trigger. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  /** Set by PATCH /api/users/me. */
  @Column({ type: 'text', nullable: true, name: 'full_name' })
  fullName: string | null;

  /** URL of the user's profile picture (S3/CDN path). Set by PATCH /api/users/me. */
  @Column({ type: 'text', nullable: true, name: 'avatar_url' })
  avatarUrl: string | null;

  /**
   * The tenant the user is currently viewing.
   * Updating this column fires the handle_tenant_context_switch trigger,
   * which syncs current_tenant_id into the Supabase Auth JWT metadata.
   * Managed exclusively by POST /api/auth/switch-tenant — not writable via PATCH /users/me.
   */
  @Column({ type: 'uuid', nullable: true, name: 'last_accessed_tenant_id' })
  lastAccessedTenantId: string | null;

  /** Phone number for SMS. E.164 format (e.g., +15551234567). */
  @Column({ type: 'text', nullable: true })
  phone: string | null;

  /** Stripe Customer ID (cus_xxx). Created lazily on first SetupIntent. User-global. */
  @Column({ type: 'text', nullable: true, unique: true, name: 'stripe_customer_id' })
  stripeCustomerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
