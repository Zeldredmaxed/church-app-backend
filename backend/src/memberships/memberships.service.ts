import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { getTierFeatures, TIER_DISPLAY_NAMES, TierName } from '../common/config/tier-features.config';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns all tenants the authenticated user belongs to, across every church.
   *
   * INTENTIONAL SERVICE-ROLE BYPASS:
   * This endpoint does NOT use the RLS QueryRunner. The RLS policy on
   * tenant_memberships filters by `current_tenant_id` from the JWT, which would
   * only return the user's membership in their currently active church — making
   * it impossible to list all their churches for the tenant switcher UI.
   *
   * Security guarantee: the userId parameter MUST be set to `request.user.sub`
   * (the verified JWT subject) by the controller. Never accept userId from the
   * request body. The query is filtered by this verified identity.
   */
  async getMyMemberships(
    userId: string,
    currentTenantId: string | null,
  ): Promise<MembershipWithTenant[]> {
    const rows: Array<{
      user_id: string;
      tenant_id: string;
      role: string;
      tenant_name: string;
      tenant_tier: string;
      tenant_slug: string | null;
      tenant_created_at: string;
      campus_name: string | null;
      parent_tenant_id: string | null;
    }> = await this.dataSource.query(
      `SELECT
         tm.user_id,
         tm.tenant_id,
         tm.role,
         t.name             AS tenant_name,
         t.tier             AS tenant_tier,
         t.slug             AS tenant_slug,
         t.created_at       AS tenant_created_at,
         t.campus_name      AS campus_name,
         t.parent_tenant_id AS parent_tenant_id
       FROM public.tenant_memberships tm
       JOIN public.tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = $1
       ORDER BY t.parent_tenant_id NULLS FIRST, t.campus_name ASC, t.name ASC`,
      [userId],
    );

    return rows.map(row => ({
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role as TenantMembership['role'],
      isCurrent: row.tenant_id === currentTenantId,
      tenant: {
        id: row.tenant_id,
        name: row.tenant_name,
        tier: row.tenant_tier,
        slug: row.tenant_slug,
        createdAt: row.tenant_created_at,
        campusName: row.campus_name,
        parentTenantId: row.parent_tenant_id,
      },
    }));
  }

  /**
   * Adds a user to the requesting admin's current tenant.
   *
   * Flow:
   *   1. Resolve the invited user by email (service role — they may be in a
   *      different tenant, so this lookup cannot be RLS-scoped).
   *   2. Check for a duplicate membership (RLS-scoped — we can only see
   *      memberships in the current tenant anyway).
   *   3. INSERT the new membership via RLS QueryRunner — the INSERT policy
   *      "memberships: insert by admin or pastor" enforces that the caller
   *      holds admin/pastor role in current_tenant_id. If they do not, Postgres
   *      raises a policy violation error, caught and rethrown as ForbiddenException
   *      by NestJS's default exception filter.
   *
   * Phase 2 TODO: After insert, enqueue a BullMQ 'notifications' job to send
   * a welcome/invitation email to the new member.
   */
  async createMembership(
    dto: CreateMembershipDto,
    requestingUser: SupabaseJwtPayload,
  ): Promise<MembershipWithTenant> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }

    const { queryRunner, currentTenantId } = context;

    if (!currentTenantId) {
      throw new BadRequestException(
        'No active tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    // Step 1: Resolve the invited user by email — service role, cross-tenant lookup
    const targetUser = await this.dataSource.manager.findOne(User, {
      where: { email: dto.email },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `No account found for ${dto.email}. They must sign up for the platform first.`,
      );
    }

    // Step 2: Reject self-invite (creates confusing UX, not a security issue per se)
    if (targetUser.id === requestingUser.sub) {
      throw new ConflictException('You are already a member of this tenant');
    }

    // Step 3: Check for duplicate (RLS-scoped — we can only see this tenant's memberships)
    const existing = await queryRunner.manager.findOne(TenantMembership, {
      where: { userId: targetUser.id, tenantId: currentTenantId },
    });

    if (existing) {
      throw new ConflictException(
        `${dto.email} is already a member of this tenant with role '${existing.role}'`,
      );
    }

    // Step 4: Check admin user limits if adding a non-member role
    if (dto.role !== 'member') {
      const tenant = await this.dataSource.manager.findOne(Tenant, {
        where: { id: currentTenantId },
        select: ['id', 'tier'],
      });
      if (tenant) {
        const features = getTierFeatures(tenant.tier);
        if (features.maxAdminUsers !== -1) {
          // Count existing non-member users in this tenant
          const adminCount: number = await this.dataSource.manager
            .createQueryBuilder(TenantMembership, 'tm')
            .where('tm.tenant_id = :tenantId', { tenantId: currentTenantId })
            .andWhere("tm.role != 'member'")
            .getCount();

          if (adminCount >= features.maxAdminUsers) {
            const tierDisplay = TIER_DISPLAY_NAMES[tenant.tier as TierName] ?? tenant.tier;
            throw new ForbiddenException(
              `Your ${tierDisplay} plan allows a maximum of ${features.maxAdminUsers} admin/staff users. ` +
              `Upgrade your plan to add more staff roles.`,
            );
          }
        }
      }
    }

    // Step 5: INSERT via RLS QueryRunner — policy enforces admin/pastor role
    const membership = queryRunner.manager.create(TenantMembership, {
      userId: targetUser.id,
      tenantId: currentTenantId,
      role: dto.role,
    });

    await queryRunner.manager.save(TenantMembership, membership);

    // Fetch the tenant name for the response (RLS-scoped)
    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });

    this.logger.log(
      `Membership created: user ${targetUser.id} added to tenant ${currentTenantId} ` +
        `as '${dto.role}' by ${requestingUser.sub}`,
    );

    // Phase 2 TODO: enqueue BullMQ 'notifications' job for invitation email
    // await this.notificationsQueue.add('NEW_MEMBER_INVITE', { ... });

    return {
      userId: targetUser.id,
      tenantId: currentTenantId,
      role: dto.role,
      isCurrent: true,
      tenant: {
        id: currentTenantId,
        name: tenant?.name ?? 'Unknown',
        tier: tenant?.tier ?? 'standard',
        slug: tenant?.slug ?? null,
        createdAt: tenant?.createdAt?.toISOString() ?? new Date().toISOString(),
      },
      newMember: {
        userId: targetUser.id,
        email: targetUser.email,
      },
    };
  }

  /**
   * Returns paginated members of a tenant with their user details.
   * Uses cursor-based pagination keyed on user_id for stable ordering.
   *
   * RLS SELECT policy: "memberships: select within current tenant" ensures
   * only members of the current tenant are visible.
   *
   * Joins to public.users to include full_name and avatar_url.
   */
  async getMembers(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ members: TenantMemberDetail[]; nextCursor: string | null }> {
    const { queryRunner } = this.getRlsContext();

    // Raw query with JOIN to users table for profile data.
    // ORDER BY full_name (NULLS LAST) then user_id for deterministic ordering.
    let query = `
      SELECT
        tm.user_id,
        tm.tenant_id,
        tm.role,
        u.email,
        u.full_name,
        u.avatar_url
      FROM public.tenant_memberships tm
      JOIN public.users u ON u.id = tm.user_id
      WHERE tm.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (cursor) {
      // Cursor: fetch the cursor user's sort key, then paginate after it
      const cursorUser = await queryRunner.query(
        `SELECT COALESCE(u.full_name, '') AS sort_key, tm.user_id
         FROM public.tenant_memberships tm
         JOIN public.users u ON u.id = tm.user_id
         WHERE tm.user_id = $1 AND tm.tenant_id = $2`,
        [cursor, tenantId],
      );
      if (cursorUser.length > 0) {
        query += ` AND (COALESCE(u.full_name, ''), tm.user_id) > ($${params.length + 1}, $${params.length + 2})`;
        params.push(cursorUser[0].sort_key, cursor);
      }
    }

    query += ` ORDER BY COALESCE(u.full_name, '') ASC, tm.user_id ASC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const rows: Array<{
      user_id: string;
      tenant_id: string;
      role: string;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    }> = await queryRunner.query(query, params);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].user_id : null;

    const members: TenantMemberDetail[] = page.map(row => ({
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role as TenantMembership['role'],
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
    }));

    return { members, nextCursor };
  }

  /**
   * Updates a member's role within the current tenant.
   *
   * RLS UPDATE policy: "memberships: update role by admin only" ensures
   * only tenant admins can change roles. Returns 404 if the membership
   * doesn't exist or the RLS policy blocks the update.
   */
  async updateRole(
    tenantId: string,
    targetUserId: string,
    dto: UpdateRoleDto,
  ): Promise<TenantMemberDetail> {
    const { queryRunner } = this.getRlsContext();

    const result = await queryRunner.manager.update(
      TenantMembership,
      { userId: targetUserId, tenantId },
      { role: dto.role },
    );

    if (result.affected === 0) {
      throw new NotFoundException(
        'Membership not found or you do not have permission to update it',
      );
    }

    // Fetch updated membership with user details
    const rows: Array<{
      user_id: string;
      tenant_id: string;
      role: string;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    }> = await queryRunner.query(
      `SELECT tm.user_id, tm.tenant_id, tm.role, u.email, u.full_name, u.avatar_url
       FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.user_id = $1 AND tm.tenant_id = $2`,
      [targetUserId, tenantId],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Membership not found');
    }

    this.logger.log(
      `Role updated: user ${targetUserId} in tenant ${tenantId} → ${dto.role}`,
    );

    return {
      userId: rows[0].user_id,
      tenantId: rows[0].tenant_id,
      role: rows[0].role as TenantMembership['role'],
      email: rows[0].email,
      fullName: rows[0].full_name,
      avatarUrl: rows[0].avatar_url,
    };
  }

  /**
   * Removes a member from the tenant.
   *
   * RLS DELETE policy: "memberships: delete by admin or self-removal" ensures:
   *   - Any user can remove themselves (leave the tenant)
   *   - Admins can remove any member
   * Returns 404 if the membership doesn't exist or the RLS policy blocks the delete.
   */
  async removeMember(tenantId: string, targetUserId: string): Promise<void> {
    const { queryRunner } = this.getRlsContext();

    const result = await queryRunner.manager.delete(TenantMembership, {
      userId: targetUserId,
      tenantId,
    });

    if (result.affected === 0) {
      throw new NotFoundException(
        'Membership not found or you do not have permission to remove it',
      );
    }

    this.logger.log(`Member ${targetUserId} removed from tenant ${tenantId}`);
  }

  /**
   * Updates a member's granular permissions within the current tenant.
   *
   * Only admins can update permissions. Uses RLS-scoped QueryRunner so the
   * UPDATE policy enforces admin-only access at the database level.
   */
  async updatePermissions(
    tenantId: string,
    targetUserId: string,
    dto: UpdatePermissionsDto,
  ): Promise<TenantMemberDetail> {
    const { queryRunner } = this.getRlsContext();

    // Validate allowed permission keys
    const allowedKeys = [
      'manage_finance',
      'manage_content',
      'manage_members',
      'manage_worship',
      'view_analytics',
    ];
    const invalidKeys = Object.keys(dto.permissions).filter(
      k => !allowedKeys.includes(k),
    );
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `Invalid permission keys: ${invalidKeys.join(', ')}. ` +
        `Allowed: ${allowedKeys.join(', ')}`,
      );
    }

    const result = await queryRunner.manager.update(
      TenantMembership,
      { userId: targetUserId, tenantId },
      { permissions: dto.permissions },
    );

    if (result.affected === 0) {
      throw new NotFoundException(
        'Membership not found or you do not have permission to update it',
      );
    }

    // Fetch updated membership with user details
    const rows: Array<{
      user_id: string;
      tenant_id: string;
      role: string;
      permissions: Record<string, boolean>;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    }> = await queryRunner.query(
      `SELECT tm.user_id, tm.tenant_id, tm.role, tm.permissions,
              u.email, u.full_name, u.avatar_url
       FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.user_id = $1 AND tm.tenant_id = $2`,
      [targetUserId, tenantId],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Membership not found');
    }

    this.logger.log(
      `Permissions updated: user ${targetUserId} in tenant ${tenantId} → ${JSON.stringify(dto.permissions)}`,
    );

    return {
      userId: rows[0].user_id,
      tenantId: rows[0].tenant_id,
      role: rows[0].role as TenantMembership['role'],
      email: rows[0].email,
      fullName: rows[0].full_name,
      avatarUrl: rows[0].avatar_url,
      permissions: rows[0].permissions,
    };
  }

  /**
   * Returns KPI metrics for the members dashboard.
   * Uses service-role DataSource (cross-tenant aggregation).
   */
  async getMemberKpis(tenantId: string) {
    // Note: tenant_memberships has no created_at/joined_at column,
    // so newThisMonth counts users whose account was created this month as a proxy.
    const rows = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = $1) AS total_members,
        (SELECT COUNT(*)::int FROM public.tenant_memberships tm JOIN public.users u ON u.id = tm.user_id WHERE tm.tenant_id = $1 AND u.created_at >= date_trunc('month', now())) AS new_this_month,
        (SELECT COUNT(DISTINCT user_id)::int FROM public.check_ins WHERE tenant_id = $1 AND checked_in_at >= now() - interval '30 days') AS active_last_30d`,
      [tenantId],
    );

    const row = rows[0] ?? {};
    return {
      totalMembers: row.total_members ?? 0,
      newThisMonth: row.new_this_month ?? 0,
      activeLast30d: row.active_last_30d ?? 0,
    };
  }

  /**
   * Exports all members of a tenant as raw rows (controller converts to CSV).
   * Uses service-role DataSource.
   */
  async exportMembers(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT u.email, u.full_name, tm.role, u.created_at
       FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1
       ORDER BY u.full_name`,
      [tenantId],
    );

    return rows as Array<{ email: string; full_name: string | null; role: string; created_at: string }>;
  }

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }
    return context;
  }

  /**
   * Bulk import members from a parsed CSV array.
   * Creates auth.users stubs + public.users + memberships.
   * Skips rows where the email already exists.
   */
  async importMembers(tenantId: string, importedBy: string, members: Array<{ email: string; fullName?: string; phone?: string; role?: string }>) {
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const m of members) {
      if (!m.email || !m.email.includes('@')) {
        errors.push(`Invalid email: ${m.email}`);
        skipped++;
        continue;
      }

      try {
        // Check if user already exists
        const [existing] = await this.dataSource.query(
          `SELECT id FROM public.users WHERE email = $1`, [m.email.toLowerCase().trim()],
        );

        let userId: string;

        if (existing) {
          userId = existing.id;
        } else {
          // Create auth.users stub
          userId = (await this.dataSource.query(
            `SELECT gen_random_uuid() AS id`,
          ))[0].id;

          await this.dataSource.query(
            `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
             VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, crypt('imported-no-password', gen_salt('bf')), now(), now(), now(), '', '', '', '')
             ON CONFLICT (email) DO NOTHING`,
            [userId, m.email.toLowerCase().trim()],
          );

          await this.dataSource.query(
            `INSERT INTO public.users (id, email, full_name, phone)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET full_name = COALESCE($3, users.full_name), phone = COALESCE($4, users.phone)`,
            [userId, m.email.toLowerCase().trim(), m.fullName ?? null, m.phone ?? null],
          );
        }

        // Add membership
        const role = ['admin', 'pastor', 'accountant', 'worship_leader', 'member'].includes(m.role ?? '') ? m.role : 'member';
        await this.dataSource.query(
          `INSERT INTO public.tenant_memberships (user_id, tenant_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, tenant_id) DO NOTHING`,
          [userId, tenantId, role],
        );

        created++;
      } catch (err: any) {
        errors.push(`${m.email}: ${err.message}`);
        skipped++;
      }
    }

    return { created, skipped, total: members.length, errors: errors.slice(0, 10) };
  }
}

export interface TenantMemberDetail {
  userId: string;
  tenantId: string;
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  permissions?: Record<string, boolean>;
}

export interface MembershipWithTenant {
  userId: string;
  tenantId: string;
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';
  isCurrent: boolean;
  tenant: {
    id: string;
    name: string;
    tier: string;
    slug: string | null;
    createdAt: string;
  };
  /** Only present on POST responses */
  newMember?: { userId: string; email: string };
}
