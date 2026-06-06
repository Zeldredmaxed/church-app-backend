-- 095: sermon_views — per-(user, sermon) watch progress.
--
-- Powers two mobile screens:
--   1. SermonLibraryScreen "Continue Watching" — sermons the user
--      started but didn't finish.
--   2. AdminSermonsScreen "Avg Watch" KPI — average watch-seconds
--      across all views (previously returned null because the table
--      didn't exist; sermons.service.getStats already defensively
--      checks to_regclass and now starts returning the real number).
--
-- Composite PK on (user_id, sermon_id) — one progress row per user
-- per sermon, idempotent UPSERT on every progress ping.

CREATE TABLE IF NOT EXISTS public.sermon_views (
  user_id              UUID NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  sermon_id            UUID NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_watched_seconds INT NOT NULL DEFAULT 0 CHECK (last_watched_seconds >= 0),
  completed_at         TIMESTAMPTZ NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sermon_id)
);

CREATE INDEX IF NOT EXISTS idx_sermon_views_user_updated
  ON public.sermon_views (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sermon_views_tenant_sermon
  ON public.sermon_views (tenant_id, sermon_id);

ALTER TABLE public.sermon_views ENABLE ROW LEVEL SECURITY;

-- Users read + write their own rows; admins read tenant rows via the
-- service-role connection for the stats endpoint.
DROP POLICY IF EXISTS "sermon_views: select own" ON public.sermon_views;
CREATE POLICY "sermon_views: select own" ON public.sermon_views
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "sermon_views: insert own" ON public.sermon_views;
CREATE POLICY "sermon_views: insert own" ON public.sermon_views
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sermon_views: update own" ON public.sermon_views;
CREATE POLICY "sermon_views: update own" ON public.sermon_views
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sermon_views: delete own" ON public.sermon_views;
CREATE POLICY "sermon_views: delete own" ON public.sermon_views
  FOR DELETE USING (user_id = auth.uid());
