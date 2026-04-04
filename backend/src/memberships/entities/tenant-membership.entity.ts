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

  @Column({ type: 'text' })
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';

  /** Granular permission overrides stored as JSONB. */
  @Column({ type: 'jsonb', default: {} })
  permissions: Record<string, boolean>;
}
