import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Custom throttler guard that applies rate limiting at multiple levels:
 *
 * 1. **IP-based** (default): All requests are rate-limited per IP address.
 *    This is the fallback for unauthenticated requests (webhooks are excluded
 *    via @SkipThrottle).
 *
 * 2. **Tenant-based**: For authenticated requests, the tracker key includes
 *    the tenant_id. This prevents a single tenant from monopolizing system
 *    resources while allowing fair distribution across tenants.
 *
 * The key format is:
 *   - Unauthenticated: `<ip>`
 *   - Authenticated:   `<tenant_id>:<ip>`
 *
 * This ensures rate limits are applied both per-IP (preventing abuse from a
 * single client) and per-tenant (preventing a single tenant from overwhelming
 * the system).
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Skip rate limiting for health-check endpoints.
   * Render's health checker polls /api/health frequently from the same IP,
   * which can exhaust the rate limit and cause the service to be marked unhealthy.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const url: string = req.url || req.originalUrl || '';
    if (url.startsWith('/api/health')) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Override the tracker key to include tenant context for authenticated requests.
   *
   * The default ThrottlerGuard uses only the IP address. By including the
   * tenant_id, we create separate rate-limit buckets per tenant, so one
   * tenant's activity doesn't count against another's limit.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    const user = req.user as SupabaseJwtPayload | undefined;

    if (user?.app_metadata?.current_tenant_id) {
      return `${user.app_metadata.current_tenant_id}:${ip}`;
    }

    return ip;
  }
}
