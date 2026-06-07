import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Maps to public.tenant_memberships.
 * Composite primary key (user_id, tenant_id) — a user can belong to many tenants
 * with a distinct role in each.
 * Extended by migrations/012_church_registration_tiers_permissions.sql (permissions column).
 */
@Entity({ schema: 'public', name: 'tenant_memberships' })
export class TenantMembership {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @PrimaryColumn('uuid', { name: 'tenant_id' })
  tenantId: string;

  /**
   * Migration 107: 'owner' is the church account holder (created by
   * signup, single per tenant — enforced via partial unique index).
   * Owner sits above admin and auto-passes every RoleGuard +
   * PermissionsGuard check.
   * 'moderator' is also a valid DB value (legacy) but unused in
   * the entity union for now — add here if surfaced in code paths.
   */
  @Column({ type: 'text' })
  role: 'owner' | 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';

  /** Granular permission overrides stored as JSONB. */
  @Column({ type: 'jsonb', default: {} })
  permissions: Record<string, boolean>;
}
