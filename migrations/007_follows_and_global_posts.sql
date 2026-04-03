-- ============================================================================
-- Migration 007: Follows Table & Global Posts Support
-- ============================================================================
-- Prerequisite: 006_media_columns.sql applied
--
-- Creates:
--   § SECTION 1 — Make posts.tenant_id nullable (enables global posts)
--   § SECTION 2 — Update posts RLS policies for global post visibility
--   § SECTION 3 — follows table
--   § SECTION 4 — follows RLS policies
--   § SECTION 5 — Performance indexes
--   § SECTION 6 — Verification queries
-- ============================================================================

-- ============================================================================
-- § SECTION 1 — Make posts.tenant_id nullable for global posts
-- ============================================================================
-- Phase 1 enforced tenant_id NOT NULL (all posts were church-internal).
-- Phase 2 introduces global posts (tenant_id = NULL) visible across the platform.

ALTER TABLE public.posts ALTER COLUMN tenant_id DROP NOT NULL;

COMMENT ON COLUMN public.posts.tenant_id IS
  'NULL = global/public post (visible in global feed). '
  'Non-NULL = church-internal post (visible only to tenant members via RLS).';

-- Index for global feed queries — fetch all global posts, newest first
CREATE INDEX IF NOT EXISTS idx_posts_global_feed
  ON public.posts (created_at DESC)
  WHERE tenant_id IS NULL;

-- ============================================================================
-- § SECTION 2 — Update posts RLS for global post visibility
-- ============================================================================
-- Global posts (tenant_id IS NULL) should be readable by any authenticated user,
-- not just members of a specific tenant.

-- Drop the existing SELECT policy and replace with one that handles both cases
DROP POLICY IF EXISTS "posts: select within current tenant" ON public.posts;

CREATE POLICY "posts: select tenant or global"
  ON public.posts
  FOR SELECT
  USING (
    -- Global posts: any authenticated user can read
    tenant_id IS NULL
    OR
    -- Tenant posts: only members of the current tenant
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Add INSERT policy for global posts (author_id must match, no tenant membership check)
CREATE POLICY "posts: insert global post"
  ON public.posts
  FOR INSERT
  WITH CHECK (
    tenant_id IS NULL
    AND author_id = auth.uid()
  );

-- ============================================================================
-- § SECTION 3 — follows table
-- ============================================================================
-- Models user-to-user follow relationships for the global social feed.
-- This table is NOT tenant-scoped — follows are platform-wide.

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite primary key: one follow relationship per pair
  PRIMARY KEY (follower_id, following_id),

  -- Prevent self-follows at the DB level
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

COMMENT ON TABLE public.follows IS
  'Platform-wide user-to-user follow relationships. '
  'Not tenant-scoped — a user can follow anyone across the platform.';

-- ============================================================================
-- § SECTION 4 — follows RLS policies
-- ============================================================================

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows FORCE ROW LEVEL SECURITY;

-- SELECT: A user can see follows involving themselves (who they follow + who follows them)
-- Also allow seeing follow lists of other users (public social feature)
CREATE POLICY "follows: select all"
  ON public.follows
  FOR SELECT
  USING (true);

-- INSERT: A user can only follow someone (they must be the follower_id)
CREATE POLICY "follows: insert as follower"
  ON public.follows
  FOR INSERT
  WITH CHECK (
    follower_id = (auth.jwt() ->> 'sub')::uuid
  );

-- DELETE: A user can unfollow (where they are follower_id)
-- or remove a follower (where they are following_id)
CREATE POLICY "follows: delete own relationships"
  ON public.follows
  FOR DELETE
  USING (
    follower_id = (auth.jwt() ->> 'sub')::uuid
    OR following_id = (auth.jwt() ->> 'sub')::uuid
  );

-- No UPDATE policy — follow relationships are binary (exist or don't).
-- There is nothing to update.

-- ============================================================================
-- § SECTION 5 — Performance indexes
-- ============================================================================

-- Query: "who does user X follow?" (fan-out source query)
CREATE INDEX idx_follows_follower
  ON public.follows (follower_id, created_at DESC);

-- Query: "who follows user X?" (follower list)
CREATE INDEX idx_follows_following
  ON public.follows (following_id, created_at DESC);

-- ============================================================================
-- § SECTION 6 — Verification queries
-- ============================================================================

-- 6a: follows table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'follows'
-- ORDER BY ordinal_position;

-- 6b: RLS policies on follows (expect 3)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'follows'
-- ORDER BY policyname;
-- Expected:
--   follows: delete own relationships | DELETE
--   follows: insert as follower       | INSERT
--   follows: select all               | SELECT

-- 6c: posts.tenant_id is now nullable
-- SELECT column_name, is_nullable FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'tenant_id';
-- Expected: is_nullable = YES

-- 6d: Updated posts SELECT policy
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'posts' AND cmd = 'SELECT';
-- Expected: "posts: select tenant or global"

-- 6e: Self-follow constraint
-- INSERT INTO public.follows (follower_id, following_id)
-- VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
-- Expected: ERROR — violates check constraint "no_self_follow"
