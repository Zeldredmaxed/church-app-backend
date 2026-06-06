-- 086_post_linked_sermon.sql
-- Sermon comments via post-linking (Q4): rather than a dedicated
-- sermon_comments table, posts can attach to a sermon via linked_sermon_id.
-- Comments on the linked post are the sermon's discussion thread.
-- ON DELETE SET NULL — deleting a sermon leaves the discussion posts as
-- normal feed posts (preserves community memory).

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS linked_sermon_id UUID NULL
  REFERENCES public.sermons(id) ON DELETE SET NULL;

-- Partial index — most posts are not sermon discussions, so a partial
-- index keeps it tiny and only useful when we filter by linked_sermon_id.
CREATE INDEX IF NOT EXISTS idx_posts_linked_sermon_id
  ON public.posts (linked_sermon_id)
  WHERE linked_sermon_id IS NOT NULL;
