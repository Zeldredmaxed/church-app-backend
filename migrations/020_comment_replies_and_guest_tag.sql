BEGIN;

-- ============================================================
-- 020 — Comment replies (parent_id) + auto "Guest" tag setup
-- ============================================================

-- Add parent_id to comments for threaded replies
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON public.comments (parent_id);

COMMENT ON COLUMN public.comments.parent_id IS
  'NULL = top-level comment. Set = reply to another comment. FK cascades on delete.';

COMMIT;
