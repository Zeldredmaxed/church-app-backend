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
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));

COMMENT ON COLUMN public.posts.visibility IS
  'public = visible to all tenant members; private = author-only';

-- Index to keep the feed query fast when filtering out private posts
CREATE INDEX idx_posts_visibility ON public.posts (visibility);

COMMIT;
