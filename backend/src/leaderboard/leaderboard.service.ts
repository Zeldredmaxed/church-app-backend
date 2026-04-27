import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateCheckinConfigDto } from './dto/update-checkin-config.dto';

type Category = 'check_ins' | 'giving' | 'attendance' | 'posts';
type Scope = 'church' | 'global';
type Period = 'all_time' | 'this_month' | 'this_week';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
  churchName?: string;
  value: number;
  label: string;
}

export interface LeaderboardResult {
  category: Category;
  scope: Scope;
  period: Period;
  entries: LeaderboardEntry[];
  myRank: number | null;
  myValue: number | null;
}

export interface UserRankEntry {
  category: Category;
  scope: Scope;
  rank: number;
  value: number;
  label: string;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly dataSource: DataSource) {}

  // ---------------------------------------------------------------------------
  // Admin Leaderboard Toggle
  // ---------------------------------------------------------------------------

  async getLeaderboardStatus(tenantId: string): Promise<{ enabled: boolean }> {
    const [row] = await this.dataSource.query(
      `SELECT leaderboard_enabled FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    return { enabled: row?.leaderboard_enabled ?? true };
  }

  async setLeaderboardStatus(tenantId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    await this.dataSource.query(
      `UPDATE public.tenants SET leaderboard_enabled = $2 WHERE id = $1`,
      [tenantId, enabled],
    );
    return { enabled };
  }

  // ---------------------------------------------------------------------------
  // Haversine distance (meters)
  // ---------------------------------------------------------------------------
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  private formatLabel(category: Category, value: number): string {
    switch (category) {
      case 'check_ins':
        return `${value} check-ins`;
      case 'giving':
        return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      case 'attendance':
        return `${value} Sundays`;
      case 'posts':
        return `${value} posts`;
      default:
        return `${value}`;
    }
  }

  private periodFilter(period: Period, dateColumn: string): string {
    switch (period) {
      case 'this_month':
        return `AND ${dateColumn} >= date_trunc('month', now())`;
      case 'this_week':
        return `AND ${dateColumn} >= date_trunc('week', now())`;
      case 'all_time':
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Core query builder
  // ---------------------------------------------------------------------------
  private buildMainQuery(
    category: Category,
    scope: Scope,
    period: Period,
    tenantId: string,
  ): { sql: string; params: any[]; dateColumn: string } {
    const params: any[] = [];

    // Only bind a tenantId param when the SQL actually references it
    // (scope='church'). If we pushed it unconditionally, Postgres would
    // see an unreferenced $1 and fail with "could not determine data type
    // of parameter $1" — TypeORM uses the extended query protocol, which
    // requires every bound parameter to appear in the SQL.
    const tenantFilter = (col: string): string => {
      if (scope !== 'church') return '';
      params.push(tenantId);
      return `AND ${col} = $${params.length}`;
    };

    const periodDateColumn = this.getDateColumn(category);
    const periodClause = this.periodFilter(period, periodDateColumn);

    let sql = '';

    switch (category) {
      case 'check_ins': {
        sql = `
          SELECT u.id AS user_id, u.full_name, u.avatar_url,
            COUNT(DISTINCT dao.open_date)::int AS value
            ${scope === 'global' ? ', t.name AS church_name' : ''}
          FROM public.daily_app_opens dao
          JOIN public.users u ON u.id = dao.user_id
          LEFT JOIN public.leaderboard_settings ls ON ls.user_id = u.id
          ${scope === 'global' ? 'JOIN public.tenants t ON t.id = dao.tenant_id AND t.leaderboard_enabled = true' : ''}
          WHERE (ls.visible IS NULL OR ls.visible = true)
            ${tenantFilter('dao.tenant_id')}
            ${periodClause}
          GROUP BY u.id${scope === 'global' ? ', t.name' : ''}
          ORDER BY value DESC`;
        break;
      }
      case 'giving': {
        sql = `
          SELECT u.id AS user_id, u.full_name, u.avatar_url,
            SUM(tr.amount)::float AS value
            ${scope === 'global' ? ', t.name AS church_name' : ''}
          FROM public.transactions tr
          JOIN public.users u ON u.id = tr.user_id
          LEFT JOIN public.leaderboard_settings ls ON ls.user_id = u.id
          ${scope === 'global' ? 'JOIN public.tenants t ON t.id = tr.tenant_id AND t.leaderboard_enabled = true' : ''}
          WHERE tr.status = 'succeeded' AND (ls.visible IS NULL OR ls.visible = true)
            ${tenantFilter('tr.tenant_id')}
            ${periodClause}
          GROUP BY u.id${scope === 'global' ? ', t.name' : ''}
          ORDER BY value DESC`;
        break;
      }
      case 'attendance': {
        sql = `
          SELECT u.id AS user_id, u.full_name, u.avatar_url,
            COUNT(*)::int AS value
            ${scope === 'global' ? ', t.name AS church_name' : ''}
          FROM public.check_ins ci
          JOIN public.users u ON u.id = ci.user_id
          LEFT JOIN public.leaderboard_settings ls ON ls.user_id = u.id
          ${scope === 'global' ? 'JOIN public.tenants t ON t.id = ci.tenant_id AND t.leaderboard_enabled = true' : ''}
          WHERE ci.user_id IS NOT NULL AND ci.is_visitor = false
            AND (ls.visible IS NULL OR ls.visible = true)
            ${tenantFilter('ci.tenant_id')}
            ${periodClause}
          GROUP BY u.id${scope === 'global' ? ', t.name' : ''}
          ORDER BY value DESC`;
        break;
      }
      case 'posts': {
        sql = `
          SELECT u.id AS user_id, u.full_name, u.avatar_url,
            COUNT(*)::int AS value
            ${scope === 'global' ? ', t.name AS church_name' : ''}
          FROM public.posts p
          JOIN public.users u ON u.id = p.author_id
          LEFT JOIN public.leaderboard_settings ls ON ls.user_id = u.id
          ${scope === 'global' ? 'JOIN public.tenants t ON t.id = p.tenant_id AND t.leaderboard_enabled = true' : ''}
          WHERE (ls.visible IS NULL OR ls.visible = true)
            ${tenantFilter('p.tenant_id')}
            ${periodClause}
          GROUP BY u.id${scope === 'global' ? ', t.name' : ''}
          ORDER BY value DESC`;
        break;
      }
    }

    return { sql, params, dateColumn: periodDateColumn };
  }

  private getDateColumn(category: Category): string {
    switch (category) {
      case 'check_ins':
        return 'dao.open_date';
      case 'giving':
        return 'tr.created_at';
      case 'attendance':
        return 'ci.checked_in_at';
      case 'posts':
        return 'p.created_at';
    }
  }

  // ---------------------------------------------------------------------------
  // getLeaderboard
  // ---------------------------------------------------------------------------
  async getLeaderboard(
    tenantId: string,
    userId: string,
    category: Category,
    scope: Scope,
    period: Period,
    limit: number,
  ): Promise<LeaderboardResult> {
    // Check if this church has leaderboards enabled
    const { enabled } = await this.getLeaderboardStatus(tenantId);
    if (!enabled) {
      return { category, scope, period, entries: [], myRank: null, myValue: null };
    }

    const { sql: mainSql, params } = this.buildMainQuery(category, scope, period, tenantId);

    // Fetch entries with LIMIT
    const limitParam = `$${params.length + 1}`;
    const limitedSql = `${mainSql} LIMIT ${limitParam}`;
    const entriesRows: any[] = await this.dataSource.query(limitedSql, [...params, limit]);

    const entries: LeaderboardEntry[] = entriesRows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      fullName: r.full_name,
      avatarUrl: r.avatar_url,
      ...(scope === 'global' && r.church_name ? { churchName: r.church_name } : {}),
      value: Number(r.value),
      label: this.formatLabel(category, Number(r.value)),
    }));

    // Get my rank/value
    const userParam = `$${params.length + 1}`;
    const rankSql = `
      WITH ranked AS (
        SELECT user_id, value, ROW_NUMBER() OVER (ORDER BY value DESC) AS rank
        FROM (${mainSql}) sub
      )
      SELECT rank::int, value FROM ranked WHERE user_id = ${userParam}
    `;
    const rankRows: any[] = await this.dataSource.query(rankSql, [...params, userId]);

    return {
      category,
      scope,
      period,
      entries,
      myRank: rankRows.length > 0 ? Number(rankRows[0].rank) : null,
      myValue: rankRows.length > 0 ? Number(rankRows[0].value) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // getUserRanks — top-10 ranks across all categories/scopes
  // ---------------------------------------------------------------------------
  async getUserRanks(tenantId: string, userId: string): Promise<UserRankEntry[]> {
    const categories: Category[] = ['check_ins', 'giving', 'attendance', 'posts'];
    const scopes: Scope[] = ['church', 'global'];
    const results: UserRankEntry[] = [];

    const promises: Promise<void>[] = [];

    for (const category of categories) {
      for (const scope of scopes) {
        promises.push(
          (async () => {
            const { sql: mainSql, params } = this.buildMainQuery(category, scope, 'all_time', tenantId);
            const userParam = `$${params.length + 1}`;
            const rankSql = `
              WITH ranked AS (
                SELECT user_id, value, ROW_NUMBER() OVER (ORDER BY value DESC) AS rank
                FROM (${mainSql}) sub
              )
              SELECT rank::int, value FROM ranked WHERE user_id = ${userParam} AND rank <= 10
            `;
            const rows: any[] = await this.dataSource.query(rankSql, [...params, userId]);
            if (rows.length > 0) {
              results.push({
                category,
                scope,
                rank: Number(rows[0].rank),
                value: Number(rows[0].value),
                label: this.formatLabel(category, Number(rows[0].value)),
              });
            }
          })(),
        );
      }
    }

    await Promise.all(promises);
    return results;
  }

  // ---------------------------------------------------------------------------
  // getMyRanks — alias for authenticated user
  // ---------------------------------------------------------------------------
  async getMyRanks(tenantId: string, userId: string): Promise<UserRankEntry[]> {
    return this.getUserRanks(tenantId, userId);
  }

  // ---------------------------------------------------------------------------
  // recordAppOpen — fire-and-forget
  // ---------------------------------------------------------------------------
  async recordAppOpen(tenantId: string, userId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO public.daily_app_opens (user_id, tenant_id, open_date) VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT DO NOTHING`,
      [userId, tenantId],
    );
  }

  // ---------------------------------------------------------------------------
  // toggleVisibility
  // ---------------------------------------------------------------------------
  async toggleVisibility(userId: string, visible: boolean): Promise<{ visible: boolean }> {
    await this.dataSource.query(
      `INSERT INTO public.leaderboard_settings (user_id, visible, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET visible = $2, updated_at = now()`,
      [userId, visible],
    );
    return { visible };
  }

  // ---------------------------------------------------------------------------
  // Check-in Config
  // ---------------------------------------------------------------------------
  async getCheckinConfig(tenantId: string) {
    const rows: any[] = await this.dataSource.query(
      `SELECT * FROM public.checkin_config WHERE tenant_id = $1`,
      [tenantId],
    );

    if (rows.length === 0) {
      return {
        tenantId,
        enabled: false,
        dayOfWeek: 0,
        startTime: '09:00',
        endTime: '12:00',
        latitude: 0,
        longitude: 0,
        radiusMeters: 800,
        pushMessage: "Good morning! Tap to check in to today's service.",
      };
    }

    const r = rows[0];
    return {
      tenantId: r.tenant_id,
      enabled: r.enabled,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      latitude: r.latitude,
      longitude: r.longitude,
      radiusMeters: r.radius_meters,
      pushMessage: r.push_message,
    };
  }

  async updateCheckinConfig(tenantId: string, dto: UpdateCheckinConfigDto) {
    const fields: string[] = [];
    const values: any[] = [tenantId];
    let idx = 1;

    if (dto.enabled !== undefined) {
      fields.push(`enabled = $${++idx}`);
      values.push(dto.enabled);
    }
    if (dto.dayOfWeek !== undefined) {
      fields.push(`day_of_week = $${++idx}`);
      values.push(dto.dayOfWeek);
    }
    if (dto.startTime !== undefined) {
      fields.push(`start_time = $${++idx}`);
      values.push(dto.startTime);
    }
    if (dto.endTime !== undefined) {
      fields.push(`end_time = $${++idx}`);
      values.push(dto.endTime);
    }
    if (dto.lat !== undefined) {
      fields.push(`latitude = $${++idx}`);
      values.push(dto.lat);
    }
    if (dto.lng !== undefined) {
      fields.push(`longitude = $${++idx}`);
      values.push(dto.lng);
    }
    if (dto.radiusMeters !== undefined) {
      fields.push(`radius_meters = $${++idx}`);
      values.push(dto.radiusMeters);
    }
    if (dto.pushMessage !== undefined) {
      fields.push(`push_message = $${++idx}`);
      values.push(dto.pushMessage);
    }

    // Build the column list and value placeholders for the INSERT portion
    const insertCols = ['tenant_id'];
    const insertVals = ['$1'];
    const allFieldNames = ['enabled', 'day_of_week', 'start_time', 'end_time', 'latitude', 'longitude', 'radius_meters', 'push_message'];
    const dtoKeys: Record<string, any> = {
      enabled: dto.enabled,
      day_of_week: dto.dayOfWeek,
      start_time: dto.startTime,
      end_time: dto.endTime,
      latitude: dto.lat,
      longitude: dto.lng,
      radius_meters: dto.radiusMeters,
      push_message: dto.pushMessage,
    };

    for (const col of allFieldNames) {
      if (dtoKeys[col] !== undefined) {
        insertCols.push(col);
        const pIdx = values.indexOf(dtoKeys[col]) + 1;
        insertVals.push(`$${pIdx}`);
      }
    }

    const updateClause = fields.length > 0 ? fields.join(', ') + ', updated_at = now()' : 'updated_at = now()';

    await this.dataSource.query(
      `INSERT INTO public.checkin_config (${insertCols.join(', ')})
       VALUES (${insertVals.join(', ')})
       ON CONFLICT (tenant_id) DO UPDATE SET ${updateClause}`,
      values,
    );

    return this.getCheckinConfig(tenantId);
  }

  // ---------------------------------------------------------------------------
  // geoCheckIn
  // ---------------------------------------------------------------------------
  async geoCheckIn(
    tenantId: string,
    userId: string,
    lat: number,
    lng: number,
  ): Promise<{ success: boolean; message: string; distance?: number }> {
    // 1. Load config
    const config = await this.getCheckinConfig(tenantId);

    // 2. Check if enabled
    if (!config.enabled) {
      return { success: false, message: 'Geo check-in is not enabled for this church' };
    }

    // 3. Check time window (UTC)
    const now = new Date();
    const currentDow = now.getUTCDay();
    if (currentDow !== config.dayOfWeek) {
      return { success: false, message: 'Check-in window is closed' };
    }

    const [startH, startM] = config.startTime.split(':').map(Number);
    const [endH, endM] = config.endTime.split(':').map(Number);
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
      return { success: false, message: 'Check-in window is closed' };
    }

    // 4. Calculate distance
    const distance = this.haversineDistance(lat, lng, config.latitude, config.longitude);
    const distanceRounded = Math.round(distance);

    // 5. Check for duplicate (1 geo check-in per user per day)
    const dupeRows: any[] = await this.dataSource.query(
      `SELECT id FROM public.check_ins
       WHERE tenant_id = $1 AND user_id = $2 AND check_in_type = 'geo'
         AND checked_in_at::date = CURRENT_DATE
       LIMIT 1`,
      [tenantId, userId],
    );
    if (dupeRows.length > 0) {
      return { success: false, message: 'You have already checked in today', distance: distanceRounded };
    }

    // 6. Check radius
    if (distance > config.radiusMeters) {
      const miles = (distance / 1609.34).toFixed(1);
      return {
        success: false,
        message: `You're too far (${miles} miles away)`,
        distance: distanceRounded,
      };
    }

    // 7. Insert check-in
    await this.dataSource.query(
      `INSERT INTO public.check_ins (tenant_id, user_id, check_in_type, latitude, longitude, distance_meters)
       VALUES ($1, $2, 'geo', $3, $4, $5)`,
      [tenantId, userId, lat, lng, distanceRounded],
    );

    return { success: true, message: 'Checked in!', distance: distanceRounded };
  }
}
