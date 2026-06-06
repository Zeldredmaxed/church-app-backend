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

  // ===========================================================================
  // Deploy 2 — per-section detail endpoints
  // ===========================================================================

  /**
   * Posts I authored. Same shape as the main feed's post card so the mobile
   * can reuse the existing component. Archived posts are excluded — the
   * owner can view them via /api/posts/archive.
   */
  async getMyPosts(userId: string, limit: number, offset: number) {
    const rows = await this.dataSource.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.video_crop_rect, p.media_aspect, p.transcode_status, p.visibility,
         p.created_at, p.updated_at,
         u.full_name AS author_full_name, u.avatar_url AS author_avatar_url,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id) AS comment_count
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE p.author_id = $1 AND p.is_archived = false
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.posts
       WHERE author_id = $1 AND is_archived = false`,
      [userId],
    );
    return {
      posts: rows.map((r: any) => this.mapPostRow(r, userId)),
      total: Number(total),
      limit,
      offset,
    };
  }

  /**
   * Comments I authored, joined to the parent post for context so the
   * mobile can render "you commented on X's post: ...".
   */
  async getMyComments(userId: string, limit: number, offset: number) {
    const rows = await this.dataSource.query(
      `SELECT
         c.id, c.content, c.created_at, c.post_id,
         p.author_id AS post_author_id,
         pu.full_name AS post_author_full_name,
         pu.avatar_url AS post_author_avatar_url,
         LEFT(p.content, 120) AS post_preview
       FROM public.comments c
       LEFT JOIN public.posts p ON p.id = c.post_id
       LEFT JOIN public.users pu ON pu.id = p.author_id
       WHERE c.author_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.comments WHERE author_id = $1`,
      [userId],
    );
    return {
      comments: rows.map((r: any) => ({
        id: r.id,
        content: r.content,
        createdAt: r.created_at,
        post: r.post_id ? {
          id: r.post_id,
          contentPreview: r.post_preview,
          author: {
            id: r.post_author_id,
            fullName: r.post_author_full_name,
            avatarUrl: r.post_author_avatar_url,
          },
        } : null,
      })),
      total: Number(total),
      limit,
      offset,
    };
  }

  /**
   * Posts I liked, ordered by like-time descending. Same post-card shape
   * as the main feed. Archived posts are excluded.
   */
  async getMyLikes(userId: string, limit: number, offset: number) {
    const rows = await this.dataSource.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.video_crop_rect, p.media_aspect, p.transcode_status, p.visibility,
         p.created_at, p.updated_at,
         u.full_name AS author_full_name, u.avatar_url AS author_avatar_url,
         pl.created_at AS liked_at,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments   WHERE post_id = p.id) AS comment_count
       FROM public.post_likes pl
       JOIN public.posts p ON p.id = pl.post_id
       LEFT JOIN public.users u ON u.id = p.author_id
       WHERE pl.user_id = $1 AND p.is_archived = false
       ORDER BY pl.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.post_likes pl
       JOIN public.posts p ON p.id = pl.post_id
       WHERE pl.user_id = $1 AND p.is_archived = false`,
      [userId],
    );
    return {
      posts: rows.map((r: any) => ({
        ...this.mapPostRow(r, userId),
        likedAt: r.liked_at,
      })),
      total: Number(total),
      limit,
      offset,
    };
  }

  /**
   * Stories I viewed. Joined to the story for context (which auto-filters
   * unexpired by leaving the join — expired stories return null for
   * `story` and we drop those rows since they're useless to the UI).
   */
  async getMyStoryViews(userId: string, limit: number, offset: number) {
    const rows = await this.dataSource.query(
      `SELECT
         sv.story_id, sv.viewed_at,
         s.media_url, s.media_type, s.text, s.expires_at,
         s.author_id, u.full_name AS author_full_name, u.avatar_url AS author_avatar_url
       FROM public.story_views sv
       JOIN public.stories s ON s.id = sv.story_id
       LEFT JOIN public.users u ON u.id = s.author_id
       WHERE sv.viewer_id = $1
       ORDER BY sv.viewed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return {
      views: rows.map((r: any) => ({
        storyId: r.story_id,
        viewedAt: r.viewed_at,
        story: {
          mediaUrl: r.media_url,
          mediaType: r.media_type,
          text: r.text,
          expiresAt: r.expires_at,
          isExpired: new Date(r.expires_at).getTime() < Date.now(),
          author: {
            id: r.author_id,
            fullName: r.author_full_name,
            avatarUrl: r.author_avatar_url,
          },
        },
      })),
      limit,
      offset,
    };
  }

  /**
   * Family activity: sent + received pending requests + accepted ties.
   */
  async getMyFamily(userId: string, tenantId: string) {
    const [sent, received, accepted] = await Promise.all([
      this.dataSource.query(
        `SELECT fc.id, fc.related_user_id AS user_id, fc.relationship, fc.relationship_label,
                fc.status, fc.requested_at,
                u.full_name, u.avatar_url
         FROM public.family_connections fc
         JOIN public.users u ON u.id = fc.related_user_id
         WHERE fc.tenant_id = $1 AND fc.user_id = $2 AND fc.status = 'pending'
         ORDER BY fc.requested_at DESC`,
        [tenantId, userId],
      ),
      this.dataSource.query(
        `SELECT fc.id, fc.user_id AS user_id, fc.relationship, fc.relationship_label,
                fc.status, fc.requested_at,
                u.full_name, u.avatar_url
         FROM public.family_connections fc
         JOIN public.users u ON u.id = fc.user_id
         WHERE fc.tenant_id = $1 AND fc.related_user_id = $2 AND fc.status = 'pending'
         ORDER BY fc.requested_at DESC`,
        [tenantId, userId],
      ),
      this.dataSource.query(
        `SELECT fc.id, fc.related_user_id AS user_id, fc.relationship, fc.relationship_label,
                fc.accepted_at,
                u.full_name, u.avatar_url
         FROM public.family_connections fc
         JOIN public.users u ON u.id = fc.related_user_id
         WHERE fc.tenant_id = $1 AND fc.user_id = $2 AND fc.status = 'accepted'
         ORDER BY fc.accepted_at DESC NULLS LAST`,
        [tenantId, userId],
      ),
    ]);
    return {
      sentRequests: sent,
      receivedRequests: received,
      acceptedConnections: accepted,
    };
  }

  /**
   * Donations I made: list + lifetime + year-to-date totals.
   */
  async getMyGiving(userId: string, limit: number, offset: number) {
    const [list, totals] = await Promise.all([
      this.dataSource.query(
        `SELECT t.id, t.amount, t.currency, t.status, t.created_at, t.fund_id, t.payment_method,
                f.name AS fund_name
         FROM public.transactions t
         LEFT JOIN public.giving_funds f ON f.id = t.fund_id
         WHERE t.user_id = $1 AND t.status = 'succeeded'
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      this.dataSource.query(
        `SELECT
           COALESCE(SUM(amount), 0)::float AS lifetime,
           COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('year', now())), 0)::float AS ytd,
           COUNT(*)::int AS total
         FROM public.transactions
         WHERE user_id = $1 AND status = 'succeeded'`,
        [userId],
      ),
    ]);
    return {
      donations: list.map((r: any) => ({
        id: r.id,
        amount: Number(r.amount),
        currency: r.currency,
        fundId: r.fund_id,
        fundName: r.fund_name,
        paymentMethod: r.payment_method,
        status: r.status,
        occurredAt: r.created_at,
      })),
      totalLifetime: totals[0]?.lifetime ?? 0,
      totalYearToDate: totals[0]?.ytd ?? 0,
      total: totals[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  /**
   * Events I RSVP'd to, split into upcoming + past via the event's start_at.
   */
  async getMyEvents(
    userId: string,
    status: 'upcoming' | 'past' = 'upcoming',
    limit = 20,
    offset = 0,
  ) {
    const startFilter =
      status === 'upcoming'
        ? `AND e.start_at >= now()`
        : `AND e.start_at < now()`;
    const orderDir = status === 'upcoming' ? 'ASC' : 'DESC';

    const rows = await this.dataSource.query(
      `SELECT
         e.id, e.title, e.description, e.location, e.start_at, e.end_at,
         e.cover_image_url, e.is_featured,
         r.status AS rsvp_status, r.created_at AS rsvp_at
       FROM public.event_rsvps r
       JOIN public.events e ON e.id = r.event_id
       WHERE r.user_id = $1 ${startFilter}
       ORDER BY e.start_at ${orderDir}
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM public.event_rsvps r
       JOIN public.events e ON e.id = r.event_id
       WHERE r.user_id = $1 ${startFilter}`,
      [userId],
    );
    return {
      events: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        location: r.location,
        startAt: r.start_at,
        endAt: r.end_at,
        coverImageUrl: r.cover_image_url,
        isFeatured: r.is_featured,
        rsvpStatus: r.rsvp_status,
        rsvpAt: r.rsvp_at,
      })),
      total: Number(total),
      limit,
      offset,
      status,
    };
  }

  /**
   * Service check-ins: list + lifetime total + consecutive-week streak.
   */
  async getMyCheckins(userId: string, limit: number, offset: number) {
    const [list, totals, weekRows] = await Promise.all([
      this.dataSource.query(
        `SELECT id, service_id, checked_in_at, is_visitor, check_in_type
         FROM public.check_ins
         WHERE user_id = $1
         ORDER BY checked_in_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total FROM public.check_ins WHERE user_id = $1`,
        [userId],
      ),
      // Distinct ISO weeks for streak computation. Streaks count consecutive
      // weeks (year+week) backwards from the most recent.
      this.dataSource.query(
        `SELECT DISTINCT date_trunc('week', checked_in_at)::date AS week
         FROM public.check_ins
         WHERE user_id = $1
         ORDER BY week DESC`,
        [userId],
      ),
    ]);

    let streakWeeks = 0;
    if (weekRows.length > 0) {
      streakWeeks = 1;
      for (let i = 1; i < weekRows.length; i++) {
        const prev = new Date(weekRows[i - 1].week);
        const curr = new Date(weekRows[i].week);
        const diffDays = (prev.getTime() - curr.getTime()) / 86_400_000;
        if (Math.round(diffDays) === 7) streakWeeks++;
        else break;
      }
    }

    return {
      checkins: list.map((r: any) => ({
        id: r.id,
        serviceId: r.service_id,
        checkedInAt: r.checked_in_at,
        isVisitor: r.is_visitor,
        checkInType: r.check_in_type,
      })),
      total: Number(totals[0]?.total ?? 0),
      currentStreakWeeks: streakWeeks,
      limit,
      offset,
    };
  }

  /**
   * Prayer activity: prayers I posted + prayers I prayed for.
   */
  async getMyPrayers(userId: string, tenantId: string, limit: number, offset: number) {
    const [mine, prayedFor] = await Promise.all([
      this.dataSource.query(
        `SELECT id, content, is_anonymous, is_answered, created_at,
                (SELECT COUNT(*)::int FROM public.prayer_prays WHERE prayer_id = p.id) AS pray_count
         FROM public.prayers p
         WHERE author_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, tenantId, limit, offset],
      ),
      this.dataSource.query(
        `SELECT pp.prayer_id, pp.created_at AS prayed_at,
                p.content, p.is_anonymous, p.is_answered,
                p.author_id,
                CASE WHEN p.is_anonymous THEN NULL ELSE u.full_name END AS author_full_name,
                CASE WHEN p.is_anonymous THEN NULL ELSE u.avatar_url END AS author_avatar_url
         FROM public.prayer_prays pp
         JOIN public.prayers p ON p.id = pp.prayer_id
         LEFT JOIN public.users u ON u.id = p.author_id
         WHERE pp.user_id = $1 AND p.tenant_id = $2
         ORDER BY pp.created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, tenantId, limit, offset],
      ),
    ]);
    return {
      myPrayers: mine.map((r: any) => ({
        id: r.id,
        content: r.content,
        isAnonymous: r.is_anonymous,
        isAnswered: r.is_answered,
        prayCount: r.pray_count,
        createdAt: r.created_at,
      })),
      prayedFor: prayedFor.map((r: any) => ({
        prayerId: r.prayer_id,
        prayedAt: r.prayed_at,
        prayer: {
          content: r.content,
          isAnonymous: r.is_anonymous,
          isAnswered: r.is_answered,
          author: r.is_anonymous ? null : {
            id: r.author_id,
            fullName: r.author_full_name,
            avatarUrl: r.author_avatar_url,
          },
        },
      })),
      limit,
      offset,
    };
  }

  /**
   * Recent sign-in events from user_login_events. Recorded at /auth/login.
   */
  async getMyLogins(userId: string, limit = 10) {
    const rows = await this.dataSource.query(
      `SELECT id, signed_in_at, user_agent, ip_address
       FROM public.user_login_events
       WHERE user_id = $1
       ORDER BY signed_in_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return {
      logins: rows.map((r: any) => ({
        id: r.id,
        signedInAt: r.signed_in_at,
        device: this.deviceFromUserAgent(r.user_agent),
        userAgent: r.user_agent,
        ipAddress: r.ip_address,
      })),
    };
  }

  /**
   * Coarse platform guess from User-Agent. Good enough for "is this me?"
   * disambiguation; not robust against UA spoofing (nor is it meant to be).
   */
  private deviceFromUserAgent(ua: string | null): string {
    if (!ua) return 'Unknown';
    const s = ua.toLowerCase();
    if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) return 'iOS';
    if (s.includes('android')) return 'Android';
    if (s.includes('mac os x')) return 'macOS';
    if (s.includes('windows')) return 'Windows';
    if (s.includes('linux')) return 'Linux';
    return 'Other';
  }

  /**
   * Builds a PostWithMeta-shaped object from a flat SQL row. Used by
   * getMyPosts and getMyLikes so the mobile gets the same post card shape
   * as the main feed without an extra adapter layer.
   */
  private mapPostRow(r: any, _userId: string) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      authorId: r.author_id,
      content: r.content,
      mediaType: r.media_type,
      mediaUrl: r.media_url,
      videoMuxPlaybackId: r.video_mux_playback_id,
      videoCropRect: r.video_crop_rect ?? null,
      mediaAspect: r.media_aspect ?? null,
      transcodeStatus: r.transcode_status ?? null,
      visibility: r.visibility,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: {
        id: r.author_id,
        fullName: r.author_full_name,
        avatarUrl: r.author_avatar_url,
      },
      likeCount: Number(r.like_count),
      commentCount: Number(r.comment_count),
    };
  }
}
