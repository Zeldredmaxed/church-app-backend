import { ForbiddenException } from '@nestjs/common';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Refuse the request when a URL-path :tenantId differs from the caller's
 * JWT current_tenant_id. RoleGuard only verifies role within the JWT's
 * active tenant — without this clamp, an admin of tenant A could
 * supply :tenantId=B in any URL-tenant admin handler and have their
 * admin role grant access to B's data.
 *
 * Call this at the top of every controller handler that takes a
 * :tenantId path param AND mutates or reads sensitive tenant data.
 */
export function assertUrlTenantMatchesJwt(
  urlTenantId: string,
  user: SupabaseJwtPayload,
): void {
  const jwtTenantId = user.app_metadata?.current_tenant_id;
  if (!jwtTenantId || jwtTenantId !== urlTenantId) {
    throw new ForbiddenException('You do not have permission to access this tenant');
  }
}
