import { AsyncLocalStorage } from 'async_hooks';
import { QueryRunner } from 'typeorm';

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
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>();
