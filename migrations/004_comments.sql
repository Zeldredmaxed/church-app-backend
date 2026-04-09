-- =============================================================================
-- MIGRATION: 004_comments.sql
-- Phase 1, Week 3 (Continued) — Comments table with RLS
--
-- Design notes:
--
-- 1. tenant_id is denormalised onto comments (it's derivable via posts.tenant_id)
--    because putting tenant_id directly on the row makes the RLS SELECT policy
--    a single equality check instead of a cross-table JOIN. At comment volume,
--    the JOIN approach would be a serious bottleneck and risks RLS recursion.
--
-- 2. validate_comment_tenant trigger enforces referential integrity between
--    comments.tenant_id and the parent post's tenant_id at the DB level —
--    independently of what the application service passes in.
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1: COMMENTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.comments (
    id        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id   UUID        NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
    tenant_id UUID        NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
    author_id UUID        NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
    content   TEXT        NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  public.comments           IS 'Comments on posts. tenant_id is denormalised for RLS performance.';
COMMENT ON COLUMN public.comments.tenant_id IS 'Must always equal the parent post''s tenant_id — enforced by validate_comment_tenant trigger.';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_comments_post_id           ON public.comments (post_id);
CREATE INDEX IF NOT EXISTS idx_comments_tenant_id         ON public.comments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_desc ON public.comments (post_id, created_at DESC);

-- Reuse the set_updated_at function from migration 003
DROP TRIGGER IF EXISTS comments_set_updated_at ON public.comments;
CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- SECTION 2: TENANT INTEGRITY TRIGGER
--
-- Ensures a comment's tenant_id always matches its parent post's tenant_id.
-- Runs as SECURITY DEFINER so it can read public.posts without RLS interference.
-- This is defence-in-depth: the service already verifies the post via RLS-scoped
-- findOne, but this trigger catches any code path that bypasses the service.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_comment_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.posts
    WHERE id = NEW.post_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'Comment tenant_id (%) does not match the tenant_id of post (%) — cross-tenant comment rejected',
      NEW.tenant_id, NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_comment_tenant ON public.comments;
CREATE TRIGGER validate_comment_tenant
  BEFORE INSERT OR UPDATE OF post_id, tenant_id ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_comment_tenant();


-- =============================================================================
-- SECTION 3: ROW-LEVEL SECURITY — COMMENTS
-- =============================================================================

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

-- SELECT: any tenant member can read comments in their current tenant
DROP POLICY IF EXISTS "comments: select within current tenant" ON public.comments;
CREATE POLICY "comments: select within current tenant"
  ON public.comments
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- INSERT: tenant members can comment; tenant_id and author_id must match JWT
DROP POLICY IF EXISTS "comments: insert by tenant member" ON public.comments;
CREATE POLICY "comments: insert by tenant member"
  ON public.comments
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.user_id   = auth.uid()
    )
  );

-- UPDATE: comment author may edit only their own comments
DROP POLICY IF EXISTS "comments: update by author only" ON public.comments;
CREATE POLICY "comments: update by author only"
  ON public.comments
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
  );

-- DELETE: comment author OR tenant admin may delete
DROP POLICY IF EXISTS "comments: delete by author or admin" ON public.comments;
CREATE POLICY "comments: delete by author or admin"
  ON public.comments
  FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      author_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
          AND tm.user_id   = auth.uid()
          AND tm.role      = 'admin'
      )
    )
  );


-- =============================================================================
-- SECTION 4: VERIFICATION QUERIES
-- =============================================================================

-- 4a. Table exists
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'comments';

-- 4b. RLS enabled and forced
-- SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'comments';

-- 4c. All 4 policies installed
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'comments'
-- ORDER BY policyname;
-- Expected:
--   comments: delete by author or admin | DELETE
--   comments: insert by tenant member   | INSERT
--   comments: select within current tenant | SELECT
--   comments: update by author only     | UPDATE

-- 4d. Trigger installed
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
-- WHERE trigger_name = 'validate_comment_tenant';

COMMIT;
