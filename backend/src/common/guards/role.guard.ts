import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

export const ROLES_KEY = 'requiredRoles';
export const RequiresRole = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Guard that checks the authenticated user's role in the current tenant.
 * Must be applied AFTER JwtAuthGuard (needs request.user).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RoleGuard)
 *   @RequiresRole('admin', 'pastor')
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as SupabaseJwtPayload | undefined;
    if (!user) throw new ForbiddenException('Authentication required');

    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) throw new ForbiddenException('No tenant context');

    const [membership] = await this.dataSource.query(
      `SELECT role FROM public.tenant_memberships WHERE user_id = $1 AND tenant_id = $2`,
      [user.sub, tenantId],
    );

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    return true;
  }
}
