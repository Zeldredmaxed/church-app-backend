-- =============================================================================
-- MIGRATION: 013_post_likes_and_saves.sql
-- Likes and saves (bookmarks) for posts.
--
-- Design notes:
--   1. Composite PK (post_id, user_id) enforces uniqueness at the DB level,
--      making INSERT ... ON CONFLICT DO NOTHING a safe idempotent upsert.
--   2. tenant_id is denormalised from the parent post for the same reason as
--      comments: RLS SELECT policies can use a single equality check instead of
--      joining back to posts.
--   3. No separate table-level sequences or triggers needed — created_at
--      defaults to NOW() and these rows are never updated.
-- =============================================================================

BEGIN;

-- =============================================================================
-- POST LIKES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id   UUID  NOT NULL REFERENCES public.posts(id)   ON DELETE CASCADE,
  user_id   UUID  NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  tenant_id UUID  NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

COMMENT ON TABLE public.post_likes IS 'One row per (user, post) like. PK enforces uniqueness — safe for idempotent INSERT ON CONFLICT DO NOTHING.';

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id   ON public.post_likes (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id   ON public.post_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_tenant_id ON public.post_likes (tenant_id);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_likes: select within current tenant" ON public.post_likes;
CREATE POLICY "post_likes: select within current tenant"
  ON public.post_likes FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "post_likes: insert own like" ON public.post_likes;
CREATE POLICY "post_likes: insert own like"
  ON public.post_likes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND user_id   = auth.uid()
    )
  );

DROP POLICY IF EXISTS "post_likes: delete own like" ON public.post_likes;
CREATE POLICY "post_likes: delete own like"
  ON public.post_likes FOR DELETE
  USING (user_id = auth.uid());


-- =============================================================================
-- POST SAVES (BOOKMARKS)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.post_saves (
  post_id   UUID  NOT NULL REFERENCES public.posts(id)   ON DELETE CASCADE,
  user_id   UUID  NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  tenant_id UUID  NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

COMMENT ON TABLE public.post_saves IS 'One row per (user, post) save/bookmark. PK enforces uniqueness.';

CREATE INDEX IF NOT EXISTS idx_post_saves_post_id   ON public.post_saves (post_id);
CREATE INDEX IF NOT EXISTS idx_post_saves_user_id   ON public.post_saves (user_id);
CREATE INDEX IF NOT EXISTS idx_post_saves_tenant_id ON public.post_saves (tenant_id);

ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_saves: select within current tenant" ON public.post_saves;
CREATE POLICY "post_saves: select within current tenant"
  ON public.post_saves FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "post_saves: insert own save" ON public.post_saves;
CREATE POLICY "post_saves: insert own save"
  ON public.post_saves FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND user_id   = auth.uid()
    )
  );

DROP POLICY IF EXISTS "post_saves: delete own save" ON public.post_saves;
CREATE POLICY "post_saves: delete own save"
  ON public.post_saves FOR DELETE
  USING (user_id = auth.uid());

COMMIT;
