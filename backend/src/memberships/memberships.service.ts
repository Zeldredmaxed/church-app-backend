import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
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
      tenant_id: string;
      role: string;
      tenant_name: string;
    }> = await this.dataSource.query(
      `SELECT
         tm.tenant_id,
         tm.role,
         t.name AS tenant_name
       FROM public.tenant_memberships tm
       JOIN public.tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = $1
       ORDER BY t.name ASC`,
      [userId],
    );

    return rows.map(row => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      role: row.role as TenantMembership['role'],
      isCurrent: row.tenant_id === currentTenantId,
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

    // Step 4: INSERT via RLS QueryRunner — policy enforces admin/pastor role
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
      tenantId: currentTenantId,
      tenantName: tenant?.name ?? 'Unknown',
      role: dto.role,
      isCurrent: true,
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

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }
    return context;
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
  tenantId: string;
  tenantName: string;
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';
  /** Whether this is the user's currently active tenant context. */
  isCurrent: boolean;
  /** Only present on POST responses */
  newMember?: { userId: string; email: string };
}
