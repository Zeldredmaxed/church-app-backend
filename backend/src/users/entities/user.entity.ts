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

  /** User-selected gender. CHECK constraint allows only the four values listed. */
  @Column({ type: 'text', nullable: true })
  gender: 'female' | 'male' | 'non_binary' | 'prefer_not_to_say' | null;

  /** Stripe Customer ID (cus_xxx). Created lazily on first SetupIntent. User-global. */
  @Column({ type: 'text', nullable: true, unique: true, name: 'stripe_customer_id' })
  stripeCustomerId: string | null;

  /** Whether the user is currently active in the app. Updated by presence middleware. */
  @Column({ type: 'boolean', name: 'is_online', default: false })
  isOnline: boolean;

  /** Last API activity timestamp. Updated on every authenticated request. */
  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt: Date | null;

  // ───── Extended profile (migration 067) ─────
  // Every field below is nullable and writable via PATCH /api/users/me.
  // Fields tagged "PRIVATE" must NEVER be included in public-facing
  // response payloads (post author cards, follower lists, etc.) —
  // only GET /api/users/me and the admin profile-extras endpoint.

  /** PRIVATE. Secondary phone number. */
  @Column({ type: 'text', nullable: true, name: 'phone_secondary' })
  phoneSecondary: string | null;

  /** PRIVATE. JSONB: { street, street2?, city, state, postalCode, country }. */
  @Column({ type: 'jsonb', nullable: true })
  address: any | null;

  @Column({ type: 'text', nullable: true, name: 'preferred_contact_method' })
  preferredContactMethod: 'email' | 'phone' | 'sms' | 'mail' | null;

  /** PRIVATE. */
  @Column({ type: 'date', nullable: true, name: 'date_of_birth' })
  dateOfBirth: string | null;

  @Column({ type: 'text', nullable: true })
  occupation: string | null;

  @Column({ type: 'text', nullable: true })
  employer: string | null;

  @Column({ type: 'text', nullable: true, name: 'marital_status' })
  maritalStatus: 'single' | 'married' | 'engaged' | 'separated' | 'divorced' | 'widowed' | null;

  @Column({ type: 'date', nullable: true })
  anniversary: string | null;

  @Column({ type: 'text', nullable: true, name: 'spouse_name' })
  spouseName: string | null;

  @Column({ type: 'boolean', nullable: true, name: 'has_children' })
  hasChildren: boolean | null;

  /** PRIVATE. JSONB array: [{ name, dateOfBirth?, notes? }, ...]. */
  @Column({ type: 'jsonb', nullable: true })
  children: any[] | null;

  /** PRIVATE. JSONB: { name, relationship, phone, email? }. */
  @Column({ type: 'jsonb', nullable: true, name: 'emergency_contact' })
  emergencyContact: any | null;

  @Column({ type: 'text', nullable: true, name: 'membership_status' })
  membershipStatus: string | null;

  @Column({ type: 'date', nullable: true, name: 'member_since' })
  memberSince: string | null;

  @Column({ type: 'boolean', nullable: true })
  baptized: boolean | null;

  @Column({ type: 'date', nullable: true, name: 'baptism_date' })
  baptismDate: string | null;

  @Column({ type: 'text', nullable: true, name: 'baptism_location' })
  baptismLocation: string | null;

  @Column({ type: 'date', nullable: true, name: 'salvation_date' })
  salvationDate: string | null;

  @Column({ type: 'text', nullable: true, name: 'previous_church' })
  previousChurch: string | null;

  @Column({ type: 'text', nullable: true, name: 'how_did_you_hear' })
  howDidYouHear: string | null;

  @Column({ type: 'text', array: true, nullable: true, name: 'service_interests' })
  serviceInterests: string[] | null;

  @Column({ type: 'text', array: true, nullable: true })
  skills: string[] | null;

  @Column({ type: 'text', array: true, nullable: true })
  languages: string[] | null;

  @Column({ type: 'text', nullable: true, name: 'tshirt_size' })
  tshirtSize: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL' | '5XL' | null;

  /** PRIVATE. */
  @Column({ type: 'text', array: true, nullable: true, name: 'dietary_restrictions' })
  dietaryRestrictions: string[] | null;

  @Column({ type: 'boolean', nullable: true, name: 'newsletter_opt_in' })
  newsletterOptIn: boolean | null;

  @Column({ type: 'boolean', nullable: true, name: 'sms_opt_in' })
  smsOptIn: boolean | null;

  @Column({ type: 'boolean', nullable: true, name: 'photo_release_consent' })
  photoReleaseConsent: boolean | null;

  @Column({ type: 'boolean', nullable: true, name: 'birthday_visible' })
  birthdayVisible: boolean | null;

  @Column({ type: 'boolean', nullable: true, name: 'anniversary_visible' })
  anniversaryVisible: boolean | null;

  /**
   * Migration 108: opt-in cross-church feed. Default false (this
   * church only). Effective state ALSO requires the tenant to be
   * on Enterprise tier AND the owner not to have disabled the
   * tenant-wide flag.
   */
  @Column({ type: 'boolean', name: 'show_global_feed', default: false })
  showGlobalFeed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
