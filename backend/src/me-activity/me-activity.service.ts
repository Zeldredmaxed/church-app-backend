import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';

const MAX_HEARTBEAT_DELTA_SECONDS = 90;

@Injectable()
export class MeActivityService {
  private readonly logger = new Logger(MeActivityService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Records app-foreground activity for the caller. Idempotent within a
   * calendar day — re-firing accumulates minutes; setting isNewSession
   * bumps session_count.
   *
   * deltaSeconds is clamped to [0, 90] server-side: an honest mobile sends
   * ~60s every minute. Anything above 90s is treated as a stall or spoof
   * and capped so a malicious client can't inflate their totals.
   */
  async heartbeat(userId: string, dto: HeartbeatDto): Promise<{ ok: true }> {
    const clampedSeconds = Math.max(
      0,
      Math.min(dto.deltaSeconds ?? 0, MAX_HEARTBEAT_DELTA_SECONDS),
    );
    const minutesDelta = clampedSeconds / 60;
    const sessionDelta = dto.isNewSession ? 1 : 0;

    await this.dataSource.query(
      `INSERT INTO public.user_app_activity
        (user_id, date, minutes_total, session_count, first_open_at, last_seen_at)
       VALUES ($1, CURRENT_DATE, $2, $3, now(), now())
       ON CONFLICT (user_id, date) DO UPDATE SET
         minutes_total = user_app_activity.minutes_total + EXCLUDED.minutes_total,
         session_count = user_app_activity.session_count + EXCLUDED.session_count,
         last_seen_at  = now()`,
      [userId, minutesDelta, sessionDelta],
    );

    return { ok: true };
  }

  /**
   * Usage breakdown for the Activity screen — total minutes/opens for the
   * range plus per-day rows for the bar chart, plus streak from
   * login_streaks.
   */
  async getUsage(
    userId: string,
    range: 'week' | 'month' | 'all' = 'week',
  ): Promise<{
    range: string;
    totalMinutes: number;
    totalOpens: number;
    currentStreakDays: number;
    longestStreakDays: number;
    daily: Array<{ date: string; minutes: number; opens: number }>;
  }> {
    const sinceClause =
      range === 'week'
        ? `AND date >= CURRENT_DATE - INTERVAL '6 days'`
        : range === 'month'
          ? `AND date >= CURRENT_DATE - INTERVAL '29 days'`
          : '';

    const rows: Array<{ date: string; minutes_total: number; session_count: number }> =
      await this.dataSource.query(
        `SELECT date, minutes_total, session_count
         FROM public.user_app_activity
         WHERE user_id = $1 ${sinceClause}
         ORDER BY date DESC`,
        [userId],
      );

    const [totals] = (await this.dataSource.query(
      `SELECT
         COALESCE(SUM(minutes_total), 0)::int AS minutes,
         COALESCE(SUM(session_count), 0)::int AS opens
       FROM public.user_app_activity
       WHERE user_id = $1 ${sinceClause}`,
      [userId],
    )) as [{ minutes: number; opens: number }];

    const [streak] = (await this.dataSource.query(
      `SELECT current_streak, longest_streak
       FROM public.login_streaks WHERE user_id = $1`,
      [userId],
    )) as [{ current_streak: number; longest_streak: number } | undefined];

    return {
      range,
      totalMinutes: totals.minutes,
      totalOpens: totals.opens,
      currentStreakDays: streak?.current_streak ?? 0,
      longestStreakDays: streak?.longest_streak ?? 0,
      daily: rows.map(r => ({
        date: r.date,
        minutes: Number(r.minutes_total),
        opens: Number(r.session_count),
      })),
    };
  }

  /**
   * Headline summary for the top of the Activity screen. One round-trip
   * returns this-week aggregates + lifetime totals across most engagement
   * surfaces. Parallel queries; total wall time ~= the slowest one.
   */
  async getSummary(userId: string): Promise<{
    thisWeek: {
      minutes: number;
      opens: number;
      posts: number;
      comments: number;
      likes: number;
      checkins: number;
      donations: number;
      followersGained: number;
      streakDays: number;
    };
    lifetime: {
      posts: number;
      comments: number;
      donationsTotal: number;
      checkins: number;
      badges: number;
    };
  }> {
    // Rolling 7-day window for "this week" — simpler + more useful than
    // calendar week, which would reset on Mondays and underweight today.
    const [
      usageRow,
      postsRow,
      commentsRow,
      likesRow,
      checkinsRow,
      donationsRow,
      followersRow,
      streakRow,
      lifetimePostsRow,
      lifetimeCommentsRow,
      lifetimeDonationsRow,
      lifetimeCheckinsRow,
      lifetimeBadgesRow,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT
           COALESCE(SUM(minutes_total), 0)::int AS minutes,
           COALESCE(SUM(session_count), 0)::int AS opens
         FROM public.user_app_activity
         WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '6 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.posts
         WHERE author_id = $1 AND created_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.comments
         WHERE author_id = $1 AND created_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.post_likes
         WHERE user_id = $1 AND created_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.check_ins
         WHERE user_id = $1 AND checked_in_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.transactions
         WHERE user_id = $1 AND status = 'succeeded'
           AND created_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.follows
         WHERE following_id = $1 AND created_at >= now() - INTERVAL '7 days'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT current_streak FROM public.login_streaks WHERE user_id = $1`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.posts WHERE author_id = $1`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.comments WHERE author_id = $1`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM public.transactions
         WHERE user_id = $1 AND status = 'succeeded'`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.check_ins WHERE user_id = $1`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM public.member_badges WHERE user_id = $1`,
        [userId],
      ),
    ]);

    return {
      thisWeek: {
        minutes: usageRow[0]?.minutes ?? 0,
        opens: usageRow[0]?.opens ?? 0,
        posts: postsRow[0]?.c ?? 0,
        comments: commentsRow[0]?.c ?? 0,
        likes: likesRow[0]?.c ?? 0,
        checkins: checkinsRow[0]?.c ?? 0,
        donations: donationsRow[0]?.c ?? 0,
        followersGained: followersRow[0]?.c ?? 0,
        streakDays: streakRow[0]?.current_streak ?? 0,
      },
      lifetime: {
        posts: lifetimePostsRow[0]?.c ?? 0,
        comments: lifetimeCommentsRow[0]?.c ?? 0,
        donationsTotal: lifetimeDonationsRow[0]?.total ?? 0,
        checkins: lifetimeCheckinsRow[0]?.c ?? 0,
        badges: lifetimeBadgesRow[0]?.c ?? 0,
      },
    };
  }
}
