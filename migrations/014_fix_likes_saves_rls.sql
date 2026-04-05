-- =============================================================================
-- MIGRATION: 014_fix_likes_saves_rls.sql
-- Fix RLS on post_likes and post_saves so that:
--   1. Authenticated users can read any likes/saves (for count subqueries)
--   2. The isSavedByMe / isLikedByMe EXISTS subqueries never return false
--      due to a tenant_id mismatch on the saves row
--   3. Table-level grants are explicitly set (Supabase doesn't auto-grant)
--
-- The previous SELECT policies required tenant_id = current_tenant_id,
-- which caused EXISTS subqueries to silently return false if the RLS
-- filtered the saves row out — making isSavedByMe always false after
-- an app restart even when the save row existed in the DB.
-- =============================================================================

BEGIN;

-- =============================================================================
-- GRANT table access to Supabase roles
-- (Supabase doesn't auto-grant new tables to authenticated/anon roles)
-- =============================================================================

GRANT SELECT, INSERT, DELETE ON public.post_likes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.post_saves TO authenticated;
GRANT SELECT ON public.post_likes TO anon;
GRANT SELECT ON public.post_saves TO anon;

-- =============================================================================
-- FIX post_likes RLS
-- SELECT: any authenticated user can read likes (needed for COUNT subqueries)
-- INSERT: user can only like in their current tenant, must be a member
-- DELETE: user can only delete their own like
-- =============================================================================

DROP POLICY IF EXISTS "post_likes: select within current tenant" ON public.post_likes;
DROP POLICY IF EXISTS "post_likes: insert own like"              ON public.post_likes;
DROP POLICY IF EXISTS "post_likes: delete own like"              ON public.post_likes;

-- Anyone authenticated can read likes — needed for like count and isLikedByMe subqueries
CREATE POLICY "post_likes: select authenticated"
  ON public.post_likes FOR SELECT
  TO authenticated
  USING (true);

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

CREATE POLICY "post_likes: delete own like"
  ON public.post_likes FOR DELETE
  USING (user_id = auth.uid());

-- =============================================================================
-- FIX post_saves RLS
-- SELECT: user can read their own saves (needed for isSavedByMe + saved feed)
-- INSERT: user can save in their current tenant, must be a member
-- DELETE: user can only delete their own save
-- =============================================================================

DROP POLICY IF EXISTS "post_saves: select within current tenant" ON public.post_saves;
DROP POLICY IF EXISTS "post_saves: insert own save"              ON public.post_saves;
DROP POLICY IF EXISTS "post_saves: delete own save"              ON public.post_saves;

-- User can always read their own saves regardless of current tenant context
-- This ensures isSavedByMe is never blocked by a tenant mismatch
CREATE POLICY "post_saves: select own saves"
  ON public.post_saves FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

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

CREATE POLICY "post_saves: delete own save"
  ON public.post_saves FOR DELETE
  USING (user_id = auth.uid());

COMMIT;
