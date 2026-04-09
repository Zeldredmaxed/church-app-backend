BEGIN;

-- ============================================================
-- 019 — Stories (24-hour ephemeral content)
-- ============================================================

-- Stories table
CREATE TABLE IF NOT EXISTS public.stories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  media_url   TEXT,
  text        TEXT,
  background_color TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

-- Story views table (composite PK)
CREATE TABLE IF NOT EXISTS public.story_views (
  story_id    UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stories_tenant_expires ON public.stories(tenant_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_author ON public.stories(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON public.story_views(viewer_id);

-- RLS — stories
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stories_select ON public.stories;
CREATE POLICY stories_select ON public.stories
  FOR SELECT
  USING (
    tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    AND expires_at > now()
  );

DROP POLICY IF EXISTS stories_insert ON public.stories;
CREATE POLICY stories_insert ON public.stories
  FOR INSERT
  WITH CHECK (
    tenant_id = (current_setting('app.current_tenant_id', true))::uuid
  );

DROP POLICY IF EXISTS stories_delete ON public.stories;
CREATE POLICY stories_delete ON public.stories
  FOR DELETE
  USING (
    tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    AND author_id = (current_setting('app.current_user_id', true))::uuid
  );

-- RLS — story_views
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS story_views_select ON public.story_views;
CREATE POLICY story_views_select ON public.story_views
  FOR SELECT
  USING (
    story_id IN (
      SELECT id FROM public.stories
      WHERE tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    )
  );

DROP POLICY IF EXISTS story_views_insert ON public.story_views;
CREATE POLICY story_views_insert ON public.story_views
  FOR INSERT
  WITH CHECK (
    story_id IN (
      SELECT id FROM public.stories
      WHERE tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    )
  );

COMMIT;
