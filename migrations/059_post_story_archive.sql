-- Migration 059: Instagram-style Archive for posts + stories.
--
-- Archive hides an item from every feed/search/profile EXCEPT the dedicated
-- archive view, which only the owner can see. Items aren't deleted — the
-- owner can unarchive at any time.
--
-- Adds a boolean column on each table with partial indexes that only cover
-- non-archived rows. Feed queries are the hot path and never touch archived
-- items, so the partial index stays smaller than a full index while still
-- accelerating the common "show recent active items" query.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Partial indexes — feed queries always filter is_archived = false, so a
-- partial index is both smaller and faster than including archived rows.
CREATE INDEX IF NOT EXISTS idx_posts_active_tenant_created
  ON public.posts (tenant_id, created_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_stories_active_author_created
  ON public.stories (author_id, created_at DESC)
  WHERE is_archived = false;

-- For the GET /posts/archive endpoint — owner viewing their own archive,
-- ordered newest-first. Small index, only covers archived rows.
CREATE INDEX IF NOT EXISTS idx_posts_archived_by_author
  ON public.posts (author_id, created_at DESC)
  WHERE is_archived = true;

CREATE INDEX IF NOT EXISTS idx_stories_archived_by_author
  ON public.stories (author_id, created_at DESC)
  WHERE is_archived = true;
