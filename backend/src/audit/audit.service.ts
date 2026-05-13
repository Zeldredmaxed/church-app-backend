import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

export interface AuditLogParams {
  /** Dotted action key, e.g. 'tag.created', 'member.role_changed'. */
  action: string;
  /** Pre-formatted human-readable summary the mobile renders directly. */
  summary: string;
  /** One of 'user' | 'post' | 'tag' | 'group' | 'event' | 'sermon' | 'fund' | 'church' | 'notification' | 'comment' | 'family'. Nullable. */
  resourceType?: string | null;
  resourceId?: string | null;
  /** Target user when the action is "done to" someone. Indexed. */
  targetUserId?: string | null;
  /** Action-specific JSON details — role from/to, amounts, reasons, etc. */
  metadata?: Record<string, unknown>;
}

/**
 * Writes audit-log rows and serves the admin browse UI.
 *
 * Write side: log() inserts via the RLS-bound queryRunner so the audit row
 * participates in the same transaction as the underlying mutation. The
 * INSERT RLS policy pins actor_user_id to auth.uid(), so forgery is
 * impossible even though writes go through the authenticated role.
 *
 * Read side: list() filters + cursor-paginates entries scoped to the
 * caller's current tenant.
 *
 * Singleton scope — request context (actor, tenant, IP, UA) is read from
 * the rlsStorage AsyncLocalStorage that RlsContextInterceptor populates.
 * Callers don't need to pass req. AuditService.log() throws if there's no
 * active context, which is the right failure mode — audit must not run
 * silently outside an authenticated request.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record a single admin action.
   *
   * - actor_role is captured at the moment of action via a sub-SELECT so a
   *   later role change doesn't rewrite history.
   * - tenant_id, actor_user_id, ip_address, user_agent are read from the
   *   request context in rlsStorage — caller doesn't pass them.
   * - The insert runs on the request's queryRunner, so it's in the same
   *   transaction as the underlying mutation. Audit failure rolls back the
   *   whole turn.
   */
  async log(params: AuditLogParams): Promise<void> {
    const ctx = rlsStorage.getStore();
    if (!ctx) {
      throw new Error(
        'AuditService.log called without an active RLS context. Ensure the route has @UseInterceptors(RlsContextInterceptor).',
      );
    }
    const req = ctx.request;
    const user = req.user;
    if (!user?.sub) {
      throw new Error('AuditService.log called without an authenticated user on the request');
    }
    const tenantId = user.app_metadata?.current_tenant_id;
    if (!tenantId) {
      throw new Error('AuditService.log called without a tenant in app_metadata.current_tenant_id');
    }

    const ip = this.extractIp(req);
    const ua = this.extractUserAgent(req);

    const conn = ctx.queryRunner;

    await conn.query(
      `INSERT INTO public.admin_audit_log
         (tenant_id, actor_user_id, actor_role, action, resource_type,
          resource_id, target_user_id, summary, metadata, ip_address, user_agent)
       VALUES (
         $1, $2,
         COALESCE(
           (SELECT role FROM public.tenant_memberships
             WHERE tenant_id = $1 AND user_id = $2),
           'unknown'
         ),
         $3, $4, $5, $6, $7, $8::jsonb, $9::inet, $10
       )`,
      [
        tenantId,
        user.sub,
        params.action,
        params.resourceType ?? null,
        params.resourceId ?? null,
        params.targetUserId ?? null,
        params.summary,
        JSON.stringify(params.metadata ?? {}),
        ip,
        ua,
      ],
    );
  }

  /**
   * Browse the log. Cursor-paginates by (created_at, id). Filters compose
   * (AND). Reverse-chronological order so admins see the latest first.
   */
  async list(query: ListAuditLogDto, tenantId: string) {
    const limit = Math.min(query.limit ?? 50, 200);
    const params: any[] = [tenantId];
    const conds: string[] = [`a.tenant_id = $1`];

    if (query.actor) {
      params.push(query.actor);
      conds.push(`a.actor_user_id = $${params.length}`);
    }
    if (query.target) {
      params.push(query.target);
      conds.push(`a.target_user_id = $${params.length}`);
    }
    if (query.action) {
      params.push(query.action);
      conds.push(`a.action = $${params.length}`);
    }
    if (query.actionPrefix) {
      params.push(query.actionPrefix + '%');
      conds.push(`a.action LIKE $${params.length}`);
    }
    if (query.resourceType) {
      params.push(query.resourceType);
      conds.push(`a.resource_type = $${params.length}`);
    }
    if (query.since) {
      params.push(query.since);
      conds.push(`a.created_at >= $${params.length}::timestamptz`);
    }
    if (query.until) {
      params.push(query.until);
      conds.push(`a.created_at < $${params.length}::timestamptz`);
    }

    // Cursor is base64(created_at|id) — opaque to the client. Carries both
    // values so we get strict ordering even when many entries share a
    // millisecond.
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      if (decoded) {
        params.push(decoded.createdAt);
        const tsIdx = params.length;
        params.push(decoded.id);
        const idIdx = params.length;
        conds.push(
          `(a.created_at, a.id) < ($${tsIdx}::timestamptz, $${idIdx}::uuid)`,
        );
      }
    }

    params.push(limit + 1);
    const limitIdx = params.length;

    const rows = await this.dataSource.query(
      `SELECT a.id, a.action, a.actor_user_id, a.actor_role,
              a.resource_type, a.resource_id, a.target_user_id,
              a.summary, a.metadata, a.created_at,
              au.full_name AS actor_full_name, au.avatar_url AS actor_avatar_url,
              tu.full_name AS target_full_name, tu.avatar_url AS target_avatar_url
       FROM public.admin_audit_log a
       LEFT JOIN public.users au ON au.id = a.actor_user_id
       LEFT JOIN public.users tu ON tu.id = a.target_user_id
       WHERE ${conds.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${limitIdx}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? this.encodeCursor(last.created_at, last.id)
      : null;

    return {
      entries: page.map((r: any) => this.mapRow(r)),
      nextCursor,
    };
  }

  async getOne(id: string, tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT a.id, a.action, a.actor_user_id, a.actor_role,
              a.resource_type, a.resource_id, a.target_user_id,
              a.summary, a.metadata, a.ip_address, a.user_agent, a.created_at,
              au.full_name AS actor_full_name, au.avatar_url AS actor_avatar_url,
              tu.full_name AS target_full_name, tu.avatar_url AS target_avatar_url
       FROM public.admin_audit_log a
       LEFT JOIN public.users au ON au.id = a.actor_user_id
       LEFT JOIN public.users tu ON tu.id = a.target_user_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId],
    );
    if (!row) return null;
    return {
      ...this.mapRow(row),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    };
  }

  // ───── helpers ─────

  private mapRow(r: any) {
    return {
      id: r.id,
      action: r.action,
      actor: {
        id: r.actor_user_id,
        fullName: r.actor_full_name,
        avatarUrl: r.actor_avatar_url,
        roleAtTime: r.actor_role,
      },
      target: r.target_user_id
        ? {
            id: r.target_user_id,
            fullName: r.target_full_name,
            avatarUrl: r.target_avatar_url,
          }
        : null,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      summary: r.summary,
      metadata: r.metadata ?? {},
      createdAt: r.created_at,
    };
  }

  private extractIp(req: any): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    return (req.ip ?? null) || null;
  }

  private extractUserAgent(req: any): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : null;
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: string; id: string } | null {
    try {
      const raw = Buffer.from(cursor, 'base64url').toString('utf8');
      const [createdAt, id] = raw.split('|');
      if (!createdAt || !id) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }
}
