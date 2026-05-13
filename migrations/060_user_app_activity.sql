-- Migration 060: Per-user, per-day app activity tracking.
--
-- The Your Activity screen needs time-on-app and session counts that the
-- existing `last_seen_at` + `daily_app_opens` don't capture. This table
-- aggregates minutes and sessions per (user, date) — the mobile sends a
-- heartbeat every 60s while foregrounded and we upsert.

CREATE TABLE IF NOT EXISTS public.user_app_activity (
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes_total   INT  NOT NULL DEFAULT 0,
  session_count   INT  NOT NULL DEFAULT 0,
  first_open_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- Covers /api/me/activity/usage range queries (per user, ordered by date desc).
CREATE INDEX IF NOT EXISTS idx_user_app_activity_user_date
  ON public.user_app_activity (user_id, date DESC);

-- Owner-only data; the service uses service-role queries (BYPASSRLS), but
-- RLS is enabled with no policies so direct PostgREST/anon access is denied
-- by default. Same pattern as stripe_processed_events (migration 057).
ALTER TABLE public.user_app_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_app_activity FORCE ROW LEVEL SECURITY;
