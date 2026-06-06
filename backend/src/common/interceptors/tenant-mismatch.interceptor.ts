import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Global guard against client-side tenant drift.
 *
 * Mobile sends `X-Active-Tenant-Id: <store.activeTenantId>` on every
 * authenticated request. If that disagrees with the JWT's
 * app_metadata.current_tenant_id, the client's SecureStore and Zustand
 * have torn apart — usually from a process kill between two
 * SecureStore writes during a tenant switch.
 *
 * We return 409 with a structured body so the mobile interceptor can
 * trigger a forced re-login + clear, instead of silently servicing the
 * request against the wrong tenant (the much worse outcome).
 *
 * Skipped on auth/public surfaces where there's no JWT to compare:
 *   - /api/auth/* (login, refresh, signup, forgot-password, reset-*)
 *   - /api/tenants/public, /tenants/register, /tenants/search
 *   - /api/legal/* (privacy/terms/account-deletion HTML)
 *   - /api/health, /api/webhooks/*  (no JWT, server-to-server)
 */
const SKIP_PREFIXES = [
  '/api/auth/',
  '/api/tenants/public',
  '/api/tenants/register',
  '/api/tenants/search',
  '/api/legal/',
  '/api/health',
  '/api/webhooks/',
  '/api/events/ical-public/', // token-authed, no JWT
  '/graphql',                 // GraphQL doesn't carry the X-Active-Tenant-Id header today
];

@Injectable()
export class TenantMismatchInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest();
    const url: string = req.originalUrl ?? req.url ?? '';

    // Skip auth-free routes
    if (SKIP_PREFIXES.some(p => url.startsWith(p))) {
      return next.handle();
    }

    const headerTenant = req.headers['x-active-tenant-id'] as string | string[] | undefined;
    if (!headerTenant) {
      // Header is optional — old clients without the interceptor pass
      // through cleanly. Only drift detection requires the header.
      return next.handle();
    }
    const headerVal = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;

    const user = req.user as SupabaseJwtPayload | undefined;
    if (!user) {
      // JwtAuthGuard will 401 — let it handle.
      return next.handle();
    }

    const jwtTenant = user.app_metadata?.current_tenant_id;
    // JWT might lack a tenant if the user is a no-church-home guest who
    // never switched in. Header without a JWT value can't drift; let
    // through. Once the user has a JWT tenant, header must match.
    if (jwtTenant && headerVal !== jwtTenant) {
      throw new ConflictException({
        statusCode: 409,
        code: 'TENANT_MISMATCH',
        message: 'Active tenant out of sync. Please log in again.',
        // Help the client log what mismatched
        jwtTenantId: jwtTenant,
        headerTenantId: headerVal,
      });
    }

    return next.handle();
  }
}
