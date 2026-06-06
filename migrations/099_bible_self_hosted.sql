-- 099: Self-hosted Bible (public-domain translations)
--
-- Stops proxying bible-api.com on the critical read path. Each
-- (translation, book, chapter) read becomes a local SQL query instead
-- of a network round-trip to a free single-maintainer upstream that
-- can go down at any time (a Sunday-morning outage would break Bible
-- reading for every member of every church).
--
-- Data: 7 public-domain English translations seeded from
-- github.com/scrollmapper/bible_databases (MIT-licensed). Runtime
-- translation keys stored in bible_verses.translation:
--   kjv, asv, bbe, darby, dra (sourced from DRC.json),
--   wbt (sourced from Webster.json), ylt.
-- The 8th supported translation (web / World English Bible) isn't in
-- that source's bulk JSON; the service falls back to the existing
-- bible-api.com proxy for web only.
--
-- ~31,000 verses per translation × 7 = ~217k rows total in bible_verses.
-- Insertion cost is one-time via the seed script
-- (backend/scripts/seed-bible.ts). Tables are global (no tenant
-- scoping) because scripture is the same for everyone.

-- ─── 1. bible_books ─────────────────────────────────────────────────
-- Per-translation book catalog. Some translations include
-- deuterocanonical books (DRC) so this can't just be a single static
-- list — but for the 7 we're seeding all use the 66-book Protestant
-- canon, and we'd insert deutero books as-is if we ever add a
-- translation with them.
CREATE TABLE IF NOT EXISTS public.bible_books (
  translation   TEXT NOT NULL,         -- 'kjv', 'asv', 'bbe', 'darby', 'drc', 'webster', 'ylt'
  slug          TEXT NOT NULL,         -- 'genesis', '1-samuel', 'song-of-solomon'
  display_name  TEXT NOT NULL,         -- 'Genesis', '1 Samuel', 'Song of Solomon'
  position      INT NOT NULL,          -- canonical order (Genesis=1, Revelation=66 for Protestant)
  testament     TEXT NOT NULL          -- 'old' | 'new' (could extend with 'apocrypha')
    CHECK (testament IN ('old', 'new', 'apocrypha')),
  chapter_count INT NOT NULL CHECK (chapter_count > 0),
  PRIMARY KEY (translation, slug)
);

CREATE INDEX IF NOT EXISTS idx_bible_books_translation_position
  ON public.bible_books (translation, position);

-- ─── 2. bible_chapter_lengths ───────────────────────────────────────
-- Per (translation, book, chapter) verse count. Lets the read
-- endpoint cap `end` server-side WITHOUT a COUNT() query and gives
-- mobile rich data for chapter-list rendering.
CREATE TABLE IF NOT EXISTS public.bible_chapter_lengths (
  translation TEXT NOT NULL,
  book_slug   TEXT NOT NULL,
  chapter     INT NOT NULL CHECK (chapter > 0),
  verse_count INT NOT NULL CHECK (verse_count > 0),
  PRIMARY KEY (translation, book_slug, chapter),
  FOREIGN KEY (translation, book_slug) REFERENCES public.bible_books(translation, slug) ON DELETE CASCADE
);

-- ─── 3. bible_verses ────────────────────────────────────────────────
-- The actual scripture. One row per (translation, book, chapter, verse).
-- ~217k rows total for 7 translations.
CREATE TABLE IF NOT EXISTS public.bible_verses (
  translation TEXT NOT NULL,
  book_slug   TEXT NOT NULL,
  chapter     INT NOT NULL CHECK (chapter > 0),
  verse       INT NOT NULL CHECK (verse > 0),
  text        TEXT NOT NULL,
  PRIMARY KEY (translation, book_slug, chapter, verse),
  FOREIGN KEY (translation, book_slug) REFERENCES public.bible_books(translation, slug) ON DELETE CASCADE
);

-- The primary key index above already covers the most common read
-- pattern (lookup by (translation, book_slug, chapter, verse range)).
-- No additional index needed.

-- ─── RLS ────────────────────────────────────────────────────────────
-- Scripture is public — no tenant scoping, no auth required.
-- The Bible controller already has no JwtAuthGuard. RLS not enabled
-- on these tables (would just add noise; nothing to protect).
