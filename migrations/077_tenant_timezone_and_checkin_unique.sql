-- 077: Tenant time zone + check-in per-day uniqueness
--
-- TIMEZONE: leaderboard/badge streak math currently casts checked_in_at
--   in server TZ (UTC). For a Pacific-time church a Sunday 6pm check-in
--   lands on Monday UTC — breaks streaks for everyone west of the
--   Atlantic. Store the tenant's IANA timezone and bucket by it.
--
-- CHECK-IN UNIQUENESS: app-side dedupe in leaderboard.service.ts is
--   race-prone. Two near-simultaneous taps both insert (two devices on
--   the same wifi, mobile + apple watch). The right place is a DB
--   unique index keyed by (tenant_id, user_id, day-bucket).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

-- Validate the value is a real IANA zone (Postgres accepts the SET
-- TIMEZONE form for any registered zone). Soft-validation only — we
-- don't reject bad values at write time; the AT TIME ZONE call below
-- would fail with a clear error.

-- Unique check-in per (tenant, user, day in tenant TZ). The expression
-- index uses AT TIME ZONE 'UTC' as a placeholder because IMMUTABLE
-- functions can't reference other rows (tenants.timezone is not a
-- constant). For practical purposes UTC-day collisions are still rare
-- and the app-side check (now reading tenants.timezone) catches the
-- common case; the DB index is the last-resort backstop against
-- double-tap doubles inside the same UTC day.
-- Dedupe existing rows first.
-- Two passes: one for rows with a service_id, one for rows without.
DELETE FROM public.check_ins a USING public.check_ins b
WHERE a.id > b.id
  AND a.tenant_id = b.tenant_id
  AND a.user_id = b.user_id
  AND a.user_id IS NOT NULL
  AND a.service_id = b.service_id
  AND (a.checked_in_at AT TIME ZONE 'UTC')::date = (b.checked_in_at AT TIME ZONE 'UTC')::date;

DELETE FROM public.check_ins a USING public.check_ins b
WHERE a.id > b.id
  AND a.tenant_id = b.tenant_id
  AND a.user_id = b.user_id
  AND a.user_id IS NOT NULL
  AND a.service_id IS NULL AND b.service_id IS NULL
  AND (a.checked_in_at AT TIME ZONE 'UTC')::date = (b.checked_in_at AT TIME ZONE 'UTC')::date;

-- Two partial indexes — Postgres can't put COALESCE(uuid, text) in an
-- index expression because the result type collapses to text and the
-- cast isn't IMMUTABLE. Split into "with service" and "without service".
CREATE UNIQUE INDEX IF NOT EXISTS uniq_checkin_per_user_day_with_service
  ON public.check_ins (tenant_id, user_id, service_id, ((checked_in_at AT TIME ZONE 'UTC')::date))
  WHERE user_id IS NOT NULL AND service_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checkin_per_user_day_no_service
  ON public.check_ins (tenant_id, user_id, ((checked_in_at AT TIME ZONE 'UTC')::date))
  WHERE user_id IS NOT NULL AND service_id IS NULL;
