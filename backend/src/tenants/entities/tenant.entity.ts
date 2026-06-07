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

  /**
   * Stripe Customer on the PLATFORM account used to bill the church for
   * their monthly Shepard subscription. Distinct from Connect (which routes
   * donations to the church's bank) and from users.stripe_customer_id
   * (donor-side customer). Lazily created on first plan upgrade.
   */
  @Column({ type: 'text', nullable: true, name: 'stripe_billing_customer_id' })
  stripeBillingCustomerId: string | null;

  /**
   * Active Stripe Subscription id for the church's monthly plan. Set when
   * checkout.session.completed fires for a plan upgrade.
   */
  @Column({ type: 'text', nullable: true, name: 'stripe_billing_subscription_id' })
  stripeBillingSubscriptionId: string | null;

  /** When false, all members excluded from church + global leaderboards. */
  @Column({ type: 'boolean', name: 'leaderboard_enabled', default: true })
  leaderboardEnabled: boolean;

  // ── Multi-site / Campus fields (migration 039) ──

  /** If set, this tenant is a campus under the parent organization. NULL = standalone or parent org. */
  @Column({ type: 'uuid', nullable: true, name: 'parent_tenant_id' })
  parentTenantId: string | null;

  /** Display name for this campus location (e.g. "10th Street Campus"). */
  @Column({ type: 'text', nullable: true, name: 'campus_name' })
  campusName: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  state: string | null;

  @Column({ type: 'text', nullable: true })
  zip: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  /** When true, social feed is isolated per campus. When false (default), shared across all campuses. */
  @Column({ type: 'boolean', name: 'feed_isolation', default: false })
  feedIsolation: boolean;

  /**
   * Single hex color (#RRGGBB) the mobile uses for ChurchPills and any
   * other brand-accent surfaces. NULL means the church hasn't set one —
   * frontend falls back to a deterministic name-hash color.
   */
  @Column({ type: 'text', nullable: true, name: 'brand_color' })
  brandColor: string | null;

  /**
   * Monthly church-wide giving goal in cents (e.g. 500_000 = $5,000).
   * Drives the giving-progress widget on dashboards. NULL = no goal set.
   * Column existed in the DB long before this entity field was added;
   * settable via PATCH /api/tenants/:id (migration 100).
   */
  @Column({ type: 'bigint', nullable: true, name: 'monthly_giving_goal_cents' })
  monthlyGivingGoalCents: number | null;

  /**
   * Migration 108: tenant-wide kill-switch for cross-tenant feed.
   * Default true (enabled). Only meaningful when tier='enterprise' —
   * non-enterprise tenants short-circuit the feature regardless of
   * this value. Owner-only editable via PATCH /api/tenants/:id.
   */
  @Column({ type: 'boolean', name: 'allow_cross_tenant_feed', default: true })
  allowCrossTenantFeed: boolean;

  /**
   * Marks the single "no church home" tenant. A signed-up user who hasn't
   * joined any real church belongs here so the rest of the app's
   * tenant-required paths still work; church-only routes refuse to serve
   * sessions with this tenant in their JWT context.
   */
  @Column({ type: 'boolean', name: 'is_guest', default: false })
  isGuest: boolean;

  /**
   * IANA timezone for the church (e.g. "America/Los_Angeles"). Used to
   * bucket check-ins by local-day for attendance streaks and leaderboard
   * "days active this week" so a Pacific-time Sunday 6pm check-in doesn't
   * land on Monday UTC. Defaults to America/New_York for back-compat.
   */
  @Column({ type: 'text', default: 'America/New_York' })
  timezone: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
