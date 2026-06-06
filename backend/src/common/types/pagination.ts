/**
 * Standard pagination envelopes. Use these consistently so the mobile +
 * admin clients can share unwrap logic instead of writing a per-endpoint
 * adapter.
 *
 * Today there are three legacy shapes scattered through the codebase
 * ({ posts, total }, { groups, nextCursor }, { notifications, page })
 * — new endpoints should pick one of the two below.
 */

export interface PaginatedOffset<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedCursor<T> {
  data: T[];
  nextCursor: string | null;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function clampLimit(raw: number | string | undefined, fallback = DEFAULT_PAGE_LIMIT): number {
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : (raw ?? fallback);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE_LIMIT);
}
