import { AsyncLocalStorage } from 'async_hooks';
import type { Request } from 'express';
import { QueryRunner } from 'typeorm';
import type { SupabaseJwtPayload } from '../types/jwt-payload.type';

/**
 * Carries the RLS-scoped QueryRunner and authenticated user context
 * across the async call stack for a single HTTP request.
 *
 * The RlsContextInterceptor populates this store at the start of each
 * authenticated request. All services retrieve the QueryRunner from here
 * to ensure their queries run inside the transaction where
 * SET LOCAL "request.jwt.claims" was applied.
 *
 * Usage in a service:
 *   const { queryRunner } = rlsStorage.getStore() ?? {};
 */
export interface RlsContext {
  /** Transaction-scoped QueryRunner with SET LOCAL role + jwt.claims applied. */
  queryRunner: QueryRunner;
  /** Authenticated user's UUID (auth.users.id). */
  userId: string;
  /** The tenant the user is currently acting within. NULL = no context set yet. */
  currentTenantId: string | null;
  /**
   * The Express request for this turn. Services that need IP / User-Agent /
   * arbitrary header context (e.g. AuditService) can read it here without
   * accepting `req` as an explicit parameter on every call.
   */
  request: Request & { user?: SupabaseJwtPayload };
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>();
