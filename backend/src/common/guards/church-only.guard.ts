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

export const CHURCH_ONLY_KEY = 'churchOnly';

/**
 * Marker decorator + guard: refuse to serve the route when the caller's
 * current tenant is the "no church home" guest tenant.
 *
 * Use on routes that are meaningless (or wrong) for users who haven't
 * joined a real church — prayer requests, fundraisers, events, sermons,
 * the church shop, etc. The mobile already hides these from the home
 * tabs in guest mode; this guard backstops direct-deep-link navigation
 * so the API itself refuses to leak church-only data into a guest
 * session.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, ChurchOnlyGuard)
 *   @ChurchOnly()
 *   @Controller('prayers')
 *   ...
 *
 * Applies at controller or route level. RoleGuard runs alongside it
 * without conflict (RoleGuard checks role; this checks tenant kind).
 */
export const ChurchOnly = () => SetMetadata(CHURCH_ONLY_KEY, true);

@Injectable()
export class ChurchOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enforced = this.reflector.getAllAndOverride<boolean>(CHURCH_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enforced) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as SupabaseJwtPayload | undefined;
    // No user on the request → either the route is genuinely public (e.g.
    // /events/ical/:tenantId) or JwtAuthGuard will reject upstream. Don't
    // double-error; pass through.
    if (!user) return true;

    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) {
      throw new ForbiddenException('You must join a church before using this feature');
    }

    const [tenant] = await this.dataSource.query(
      `SELECT is_guest FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    if (tenant?.is_guest) {
      throw new ForbiddenException('You must join a church before using this feature');
    }

    return true;
  }
}
