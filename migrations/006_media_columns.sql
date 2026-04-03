-- ============================================================================
-- Migration 006: Media Columns on Posts
-- ============================================================================
-- Prerequisite: 005_notifications.sql applied
--
-- Modifies:
--   § SECTION 1 — Add media_type and media_url columns to posts
--   § SECTION 2 — Backfill existing rows
--   § SECTION 3 — Verification queries
-- ============================================================================

-- ============================================================================
-- § SECTION 1 — Add media columns to posts
-- ============================================================================

-- media_type: classifies the post content type.
-- Default 'text' ensures all existing posts are valid after migration.
-- CHECK constraint enforces a closed set of allowed values.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'text'
  CHECK (media_type IN ('text', 'image', 'video'));

-- media_url: S3 object URL for image posts.
-- NULL for text-only posts and video posts (which use video_mux_playback_id).
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_url TEXT;

COMMENT ON COLUMN public.posts.media_type IS
  'Content type: text (default), image (S3 URL in media_url), or video (Mux playback ID in video_mux_playback_id).';

COMMENT ON COLUMN public.posts.media_url IS
  'S3 object URL for image posts. NULL for text and video posts.';

-- ============================================================================
-- § SECTION 2 — Backfill existing rows
-- ============================================================================

-- Set media_type = 'video' for any existing posts that already have a Mux playback ID.
-- This is idempotent — safe to run multiple times.
UPDATE public.posts
SET media_type = 'video'
WHERE video_mux_playback_id IS NOT NULL
  AND media_type = 'text';

-- ============================================================================
-- § SECTION 3 — Verification queries
-- ============================================================================

-- 3a: Confirm new columns exist
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'posts'
--   AND column_name IN ('media_type', 'media_url')
-- ORDER BY column_name;

-- Expected:
-- | column_name | data_type | is_nullable | column_default |
-- | media_type  | text      | NO          | 'text'::text   |
-- | media_url   | text      | YES         | NULL           |

-- 3b: Confirm CHECK constraint
-- SELECT conname, consrc FROM pg_constraint
-- WHERE conrelid = 'public.posts'::regclass
--   AND contype = 'c'
--   AND conname LIKE '%media_type%';

-- 3c: Verify no existing posts were corrupted
-- SELECT media_type, count(*) FROM public.posts GROUP BY media_type;
