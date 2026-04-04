import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';
import { TenantMembership } from '../../memberships/entities/tenant-membership.entity';

/**
 * Guard that enforces granular permission checks on API endpoints.
 *
 * Must be applied AFTER JwtAuthGuard (needs request.user).
 *
 * Checks:
 *   1. User must be authenticated (request.user exists).
 *   2. User must have an active tenant context (current_tenant_id in JWT).
 *   3. User must have a membership in the current tenant.
 *   4. User's role must be 'admin' (bypasses all checks) OR
 *      the membership's permissions JSONB must include at least one of
 *      the required permissions set to true.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @Permissions('manage_finance')
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Permissions() decorator — allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as SupabaseJwtPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const currentTenantId = user.app_metadata?.current_tenant_id;
    if (!currentTenantId) {
      throw new ForbiddenException(
        'No tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    // Look up the user's membership in the current tenant
    const membership = await this.dataSource.manager.findOne(TenantMembership, {
      where: { userId: user.sub, tenantId: currentTenantId },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this tenant');
    }

    // Admins bypass all permission checks
    if (membership.role === 'admin') {
      return true;
    }

    // Check if the user has at least one of the required permissions
    const permissions = membership.permissions || {};
    const hasPermission = requiredPermissions.some(
      perm => permissions[perm] === true,
    );

    if (!hasPermission) {
      this.logger.warn(
        `Permission denied: user ${user.sub} lacks [${requiredPermissions.join(', ')}] ` +
        `in tenant ${currentTenantId} (role: ${membership.role})`,
      );
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredPermissions.join(' or ')}`,
      );
    }

    return true;
  }
}
