-- Migration 061: Track sign-in events for the Activity → Recent logins screen.
--
-- Supabase's auth.audit_log_entries is empty on this project — they only
-- log audit events on paid plans. We need our own minimal table so the
-- Activity screen can show 'You signed in 2 hours ago from iOS'.

CREATE TABLE IF NOT EXISTS public.user_login_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signed_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent    TEXT,
  ip_address    INET
);

CREATE INDEX IF NOT EXISTS idx_user_login_events_user_signed_in
  ON public.user_login_events (user_id, signed_in_at DESC);

-- Owner-only data. Service-role writes from AuthService on POST /auth/login;
-- MeActivityService reads it via service role. Enable RLS with no policies
-- so PostgREST/anon access denies by default.
ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_login_events FORCE ROW LEVEL SECURITY;
