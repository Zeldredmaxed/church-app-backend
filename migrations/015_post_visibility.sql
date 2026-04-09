-- =============================================================================
-- MIGRATION: 015_post_visibility.sql
-- Add visibility column to posts.
--
-- Values: 'public' (default, visible to all tenant members in feed)
--         'private' (visible only to the author)
--
-- The feed SELECT policy already filters by tenant_id via RLS.
-- Private posts are additionally hidden from other users at the query level
-- (WHERE visibility = 'public' OR author_id = current_user_id).
-- =============================================================================

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

-- Add the check constraint idempotently
DO $$ BEGIN
  ALTER TABLE public.posts
    ADD CONSTRAINT posts_visibility_check CHECK (visibility IN ('public', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.posts.visibility IS
  'public = visible to all tenant members; private = author-only';

-- Index to keep the feed query fast when filtering out private posts
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON public.posts (visibility);

COMMIT;
