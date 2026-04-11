import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { DataSource } from 'typeorm';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Global interceptor that updates the authenticated user's online presence.
 * - Sets is_online = true and last_seen_at = now()
 * - Fire-and-forget: runs after guards populate req.user, doesn't block the response
 * - Throttled in-memory: only hits DB if last update was 30+ seconds ago
 */
@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PresenceInterceptor.name);
  private readonly recentlyUpdated = new Map<string, number>();

  constructor(private readonly dataSource: DataSource) {
    // Purge stale entries every 10 minutes
    setInterval(() => {
      const cutoff = Date.now() - 600_000;
      for (const [key, ts] of this.recentlyUpdated) {
        if (ts < cutoff) this.recentlyUpdated.delete(key);
      }
    }, 300_000).unref();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as SupabaseJwtPayload | undefined;

    if (user?.sub) {
      const now = Date.now();
      const lastUpdate = this.recentlyUpdated.get(user.sub) ?? 0;

      if (now - lastUpdate >= 300_000) { // 5 minutes
        this.recentlyUpdated.set(user.sub, now);
        // Fire-and-forget — don't await
        this.dataSource.query(
          `UPDATE public.users SET is_online = true, last_seen_at = now() WHERE id = $1`,
          [user.sub],
        ).catch(() => {});
      }
    }

    return next.handle();
  }
}
