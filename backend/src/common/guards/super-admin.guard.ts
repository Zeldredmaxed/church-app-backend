import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Restricts a route to platform super admins only.
 *
 * Super admins are identified by their email address being present in the
 * SUPER_ADMIN_EMAILS environment variable (comma-separated list).
 *
 * IMPORTANT: This guard must be applied AFTER JwtAuthGuard, because it reads
 * request.user which JwtAuthGuard populates.
 *
 *   @UseGuards(JwtAuthGuard, SuperAdminGuard)
 *
 * This is a temporary mechanism for the MVP phase. Replace with a dedicated
 * platform_admins DB table before expanding the super admin team.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: SupabaseJwtPayload }>();
    const user = request.user;

    if (!user?.email) {
      // Should not happen if JwtAuthGuard ran first, but guard against it
      throw new ForbiddenException('Access denied');
    }

    const superAdminEmails = this.config
      .get<string>('SUPER_ADMIN_EMAILS', '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    if (!superAdminEmails.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Super admin access required');
    }

    return true;
  }
}
