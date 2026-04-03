-- ============================================================================
-- Migration 009: Full-Text Search (tsvector columns, GIN indexes, triggers)
-- ============================================================================
-- Prerequisite: 008_chat.sql applied
--
-- Creates:
--   S SECTION 1 -- posts.search_vector column + GIN index
--   S SECTION 2 -- posts search_vector trigger (content + author full_name)
--   S SECTION 3 -- users.search_vector column + GIN index
--   S SECTION 4 -- users search_vector trigger (full_name + email)
--   S SECTION 5 -- Backfill existing data
--   S SECTION 6 -- Verification queries
-- ============================================================================

-- ============================================================================
-- S SECTION 1 -- posts.search_vector column + GIN index
-- ============================================================================
-- tsvector stores the pre-computed search tokens for fast full-text matching.
-- We use 'english' configuration for stemming (e.g., "running" matches "run").

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- GIN (Generalized Inverted Index) is the correct index type for tsvector.
-- It supports efficient containment queries (@@) unlike btree.
CREATE INDEX IF NOT EXISTS idx_posts_search_vector
  ON public.posts USING GIN (search_vector);

COMMENT ON COLUMN public.posts.search_vector IS
  'Pre-computed tsvector from post content + author full_name. '
  'Used by websearch_to_tsquery for full-text search. '
  'Updated automatically by trigger on INSERT/UPDATE.';

-- ============================================================================
-- S SECTION 2 -- posts search_vector trigger
-- ============================================================================
-- The trigger computes the search vector from:
--   A weight: author full_name (highest relevance — searching by author)
--   B weight: post content (primary text body)
--
-- Cross-table join: We look up the author's full_name from public.users.
-- This means the search vector includes the author's name at write time.
-- If the author renames, a background job should reindex their posts.

CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
DECLARE
  author_name TEXT;
BEGIN
  -- Fetch the author's current full_name
  SELECT COALESCE(full_name, '') INTO author_name
  FROM public.users
  WHERE id = NEW.author_id;

  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(author_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_posts_search_vector
  BEFORE INSERT OR UPDATE OF content ON public.posts
  FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

-- ============================================================================
-- S SECTION 3 -- users.search_vector column + GIN index
-- ============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_users_search_vector
  ON public.users USING GIN (search_vector);

COMMENT ON COLUMN public.users.search_vector IS
  'Pre-computed tsvector from full_name + email. '
  'Used by websearch_to_tsquery for member search within a tenant. '
  'Updated automatically by trigger on INSERT/UPDATE.';

-- ============================================================================
-- S SECTION 4 -- users search_vector trigger
-- ============================================================================
-- The trigger computes the search vector from:
--   A weight: full_name (highest relevance)
--   B weight: email (secondary — useful for admin lookups)

CREATE OR REPLACE FUNCTION users_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.email, '')), 'B');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_search_vector
  BEFORE INSERT OR UPDATE OF full_name, email ON public.users
  FOR EACH ROW EXECUTE FUNCTION users_search_vector_update();

-- ============================================================================
-- S SECTION 5 -- Backfill existing data
-- ============================================================================
-- Populate search_vector for all existing rows.
-- The trigger only fires on INSERT/UPDATE, so existing rows need explicit backfill.

-- Backfill posts: join to users for author name
UPDATE public.posts p
SET search_vector =
  setweight(to_tsvector('english', COALESCE(u.full_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(p.content, '')), 'B')
FROM public.users u
WHERE u.id = p.author_id
  AND p.search_vector IS NULL;

-- Backfill users
UPDATE public.users
SET search_vector =
  setweight(to_tsvector('english', COALESCE(full_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(email, '')), 'B')
WHERE search_vector IS NULL;

-- ============================================================================
-- S SECTION 6 -- Verification queries
-- ============================================================================

-- 6a: search_vector column exists on posts
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'search_vector';
-- Expected: 1 row, data_type = 'tsvector'

-- 6b: search_vector column exists on users
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'search_vector';
-- Expected: 1 row, data_type = 'tsvector'

-- 6c: GIN indexes exist
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND indexname IN ('idx_posts_search_vector', 'idx_users_search_vector');
-- Expected: 2 rows, both using GIN

-- 6d: Triggers exist
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public' AND trigger_name IN ('trg_posts_search_vector', 'trg_users_search_vector');
-- Expected: trg_posts_search_vector (INSERT, UPDATE), trg_users_search_vector (INSERT, UPDATE)

-- 6e: Full-text search works on posts
-- INSERT INTO public.posts (author_id, content, tenant_id)
-- VALUES ('<user_id>', 'The church picnic was wonderful', '<tenant_id>');
-- SELECT id, content FROM public.posts
-- WHERE search_vector @@ websearch_to_tsquery('english', 'church picnic');
-- Expected: returns the inserted post

-- 6f: Full-text search works on users
-- SELECT id, full_name FROM public.users
-- WHERE search_vector @@ websearch_to_tsquery('english', 'John');
-- Expected: returns users with "John" in their full_name

-- 6g: Search ranking with ts_rank
-- SELECT id, content, ts_rank(search_vector, websearch_to_tsquery('english', 'church')) AS rank
-- FROM public.posts
-- WHERE search_vector @@ websearch_to_tsquery('english', 'church')
-- ORDER BY rank DESC;
-- Expected: results ordered by relevance
