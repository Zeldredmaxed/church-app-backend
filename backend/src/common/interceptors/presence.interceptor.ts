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
        // Fire-and-forget — don't await, don't block the response
        this.dataSource.query(
          `UPDATE public.users SET is_online = true, last_seen_at = now() WHERE id = $1`,
          [user.sub],
        ).catch(err => this.logger.warn(`Presence update failed: ${err.message}`));

        // Roll the login streak forward on any authenticated activity, not
        // just /auth/login. If the user stays signed in for N days, the
        // login endpoint never fires, so the streak was stuck at 1. This
        // upsert is idempotent within a day (last_login_date = CURRENT_DATE
        // returns the existing streak unchanged) and only increments when
        // last_login_date = CURRENT_DATE - 1, so it's safe to call on every
        // 5-min throttle window.
        this.dataSource.query(
          `INSERT INTO public.login_streaks
             (user_id, current_streak, longest_streak, last_login_date, updated_at)
           VALUES ($1, 1, 1, CURRENT_DATE, now())
           ON CONFLICT (user_id) DO UPDATE SET
             current_streak = CASE
               WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
               WHEN login_streaks.last_login_date = CURRENT_DATE     THEN login_streaks.current_streak
               ELSE 1
             END,
             longest_streak = GREATEST(
               login_streaks.longest_streak,
               CASE
                 WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
                 WHEN login_streaks.last_login_date = CURRENT_DATE     THEN login_streaks.current_streak
                 ELSE 1
               END
             ),
             last_login_date = CURRENT_DATE,
             updated_at = now()`,
          [user.sub],
        ).catch(err => this.logger.warn(`Streak update failed: ${err.message}`));
      }
    }

    return next.handle();
  }
}
