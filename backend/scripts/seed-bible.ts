/**
 * Seed script for the self-hosted Bible tables (migration 099).
 *
 * Pulls 7 public-domain English translations from
 * github.com/scrollmapper/bible_databases (MIT-licensed bulk JSON):
 *   KJV, ASV, BBE, Darby, DRC (→ dra), Webster (→ wbt), YLT.
 *
 * Each source file has the shape:
 *   { translation: "...", books: [
 *       { name: "Genesis", chapters: [
 *           { chapter: 1, verses: [{ verse: 1, text: "..." }, ...] },
 *       ...] },
 *     ...] }
 *
 * Per translation we (1) compute book metadata (slug, position,
 * testament, chapter_count), (2) compute per-chapter verse counts,
 * (3) batch-INSERT books + chapter lengths + verses.
 *
 * Re-runnable — uses ON CONFLICT DO UPDATE so future scrollmapper
 * text corrections actually propagate to our DB on re-seed (the
 * previous DO NOTHING was "safe to re-run but does nothing useful").
 *
 * Run with: cd backend && npx ts-node --transpile-only scripts/seed-bible.ts
 *
 * Connection uses the same prod credentials as other seed scripts.
 * Run takes ~30 seconds end-to-end.
 */
import { Client } from 'pg';

// ─── Source config ──────────────────────────────────────────────────

interface SourceTranslation {
  /** Our internal lowercase translation key, exposed to mobile. */
  key: string;
  /** scrollmapper filename (case-sensitive, .json). */
  filename: string;
}

const SOURCES: SourceTranslation[] = [
  { key: 'kjv',     filename: 'KJV.json' },
  { key: 'asv',     filename: 'ASV.json' },
  { key: 'bbe',     filename: 'BBE.json' },
  { key: 'darby',   filename: 'Darby.json' },
  { key: 'dra',     filename: 'DRC.json' },     // Douay-Rheims Challoner ≈ DRA
  { key: 'wbt',     filename: 'Webster.json' }, // 1833 Webster Bible
  { key: 'ylt',     filename: 'YLT.json' },
];

const RAW_BASE = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json';

// ─── Book canonical metadata ────────────────────────────────────────
// The 66 Protestant canon books in order. We use this to:
//   - assign `position` (1..66)
//   - assign `testament` (OT = 1..39, NT = 40..66)
//   - normalize the source's display name → slug
// Some translations (DRC) include deuterocanonicals; the seed
// gracefully skips books not in this list (deutero books would
// need their own canonical-order extension).

const PROTESTANT_CANON: Array<{ name: string; testament: 'old' | 'new' }> = [
  // OT
  { name: 'Genesis', testament: 'old' }, { name: 'Exodus', testament: 'old' },
  { name: 'Leviticus', testament: 'old' }, { name: 'Numbers', testament: 'old' },
  { name: 'Deuteronomy', testament: 'old' }, { name: 'Joshua', testament: 'old' },
  { name: 'Judges', testament: 'old' }, { name: 'Ruth', testament: 'old' },
  { name: '1 Samuel', testament: 'old' }, { name: '2 Samuel', testament: 'old' },
  { name: '1 Kings', testament: 'old' }, { name: '2 Kings', testament: 'old' },
  { name: '1 Chronicles', testament: 'old' }, { name: '2 Chronicles', testament: 'old' },
  { name: 'Ezra', testament: 'old' }, { name: 'Nehemiah', testament: 'old' },
  { name: 'Esther', testament: 'old' }, { name: 'Job', testament: 'old' },
  { name: 'Psalms', testament: 'old' }, { name: 'Proverbs', testament: 'old' },
  { name: 'Ecclesiastes', testament: 'old' }, { name: 'Song of Solomon', testament: 'old' },
  { name: 'Isaiah', testament: 'old' }, { name: 'Jeremiah', testament: 'old' },
  { name: 'Lamentations', testament: 'old' }, { name: 'Ezekiel', testament: 'old' },
  { name: 'Daniel', testament: 'old' }, { name: 'Hosea', testament: 'old' },
  { name: 'Joel', testament: 'old' }, { name: 'Amos', testament: 'old' },
  { name: 'Obadiah', testament: 'old' }, { name: 'Jonah', testament: 'old' },
  { name: 'Micah', testament: 'old' }, { name: 'Nahum', testament: 'old' },
  { name: 'Habakkuk', testament: 'old' }, { name: 'Zephaniah', testament: 'old' },
  { name: 'Haggai', testament: 'old' }, { name: 'Zechariah', testament: 'old' },
  { name: 'Malachi', testament: 'old' },
  // NT
  { name: 'Matthew', testament: 'new' }, { name: 'Mark', testament: 'new' },
  { name: 'Luke', testament: 'new' }, { name: 'John', testament: 'new' },
  { name: 'Acts', testament: 'new' }, { name: 'Romans', testament: 'new' },
  { name: '1 Corinthians', testament: 'new' }, { name: '2 Corinthians', testament: 'new' },
  { name: 'Galatians', testament: 'new' }, { name: 'Ephesians', testament: 'new' },
  { name: 'Philippians', testament: 'new' }, { name: 'Colossians', testament: 'new' },
  { name: '1 Thessalonians', testament: 'new' }, { name: '2 Thessalonians', testament: 'new' },
  { name: '1 Timothy', testament: 'new' }, { name: '2 Timothy', testament: 'new' },
  { name: 'Titus', testament: 'new' }, { name: 'Philemon', testament: 'new' },
  { name: 'Hebrews', testament: 'new' }, { name: 'James', testament: 'new' },
  { name: '1 Peter', testament: 'new' }, { name: '2 Peter', testament: 'new' },
  { name: '1 John', testament: 'new' }, { name: '2 John', testament: 'new' },
  { name: '3 John', testament: 'new' }, { name: 'Jude', testament: 'new' },
  { name: 'Revelation', testament: 'new' },
];

// Build name → position + testament + slug lookup.
const BOOK_INDEX = new Map<string, { position: number; testament: 'old' | 'new'; slug: string }>();
PROTESTANT_CANON.forEach((b, i) => {
  const slug = b.name.toLowerCase().replace(/\s+/g, '-');
  BOOK_INDEX.set(b.name.toLowerCase(), { position: i + 1, testament: b.testament, slug });
});

// scrollmapper uses some slightly different display names. Map them.
const NAME_ALIASES: Record<string, string> = {
  'song of songs':         'song of solomon',
  'psalm':                 'psalms',
  'canticle of canticles': 'song of solomon',  // DRC variant
  'revelation of john':    'revelation',       // scrollmapper variant
  'apocalypse':            'revelation',       // older Catholic variant
  // DRC OT also has "1 Esdras"=Ezra (in some), "2 Esdras"=Nehemiah, etc.
  // We skip unrecognized books (deuterocanonicals will fall through).
};

/**
 * Normalize a raw book name to its canonical form. Handles:
 *   - Lowercase + trim
 *   - Roman numeral prefixes: "I Samuel" → "1 samuel", "II Kings" → "2 kings",
 *     "III John" → "3 john"  (scrollmapper convention)
 *   - Explicit name aliases (Song of Songs → Song of Solomon, etc.)
 */
function canonicalize(rawName: string): string {
  let lower = rawName.toLowerCase().trim();
  // Roman numeral prefix at start of name.
  lower = lower.replace(/^iii\s+/, '3 ');
  lower = lower.replace(/^ii\s+/,  '2 ');
  lower = lower.replace(/^i\s+/,   '1 ');
  return NAME_ALIASES[lower] ?? lower;
}

function resolveBook(rawName: string): { position: number; testament: 'old' | 'new'; slug: string } | null {
  return BOOK_INDEX.get(canonicalize(rawName)) ?? null;
}

// ─── DB connection ──────────────────────────────────────────────────

const DB_CONFIG = {
  host: 'db.fymcroumzokahctpsvaq.supabase.co',
  port: 5432,
  user: 'postgres',
  password: '04291992Ddcc...',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
};

// ─── Batched insert helper ──────────────────────────────────────────

/**
 * Batched parameterized INSERT. The VALUES clause is built from
 * numeric indices only — never interpolates user data — so this is
 * SQL-injection-safe regardless of caller input.
 *
 * The `conflictClause` parameter lets each table specify its own
 * ON CONFLICT behavior. For our 3 Bible tables we use DO UPDATE
 * so re-running the seed refreshes text + metadata in place.
 *
 * Note: `params = batch.flat()` assumes every column value is a
 * primitive. None of our rows include array/JSONB columns so this
 * is safe today. If a future caller passes a TEXT[] column, switch
 * to a reduce that pushes row elements individually.
 */
async function batchInsert(
  client: Client,
  sql: string,
  rows: Array<any[]>,
  paramsPerRow: number,
  conflictClause: string,
  batchSize = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch
      .map((_, b) => `(${Array.from({ length: paramsPerRow }, (_, p) => `$${b * paramsPerRow + p + 1}`).join(',')})`)
      .join(',');
    const params = batch.flat();
    await client.query(sql + ' VALUES ' + values + ' ' + conflictClause, params);
  }
}

// ─── Per-translation ingest ─────────────────────────────────────────

interface RawBibleJson {
  translation: string;
  books: Array<{
    name: string;
    chapters: Array<{
      chapter: number;
      verses: Array<{ verse: number; text: string }>;
    }>;
  }>;
}

async function ingestTranslation(client: Client, source: SourceTranslation): Promise<{ books: number; chapters: number; verses: number; skipped: string[] }> {
  const url = `${RAW_BASE}/${source.filename}`;
  console.log(`  fetching ${url} ...`);
  const t0 = Date.now();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const raw = (await resp.json()) as RawBibleJson;
  const t1 = Date.now();
  console.log(`  fetched in ${t1 - t0}ms; parsing ${raw.books?.length ?? 0} books`);

  const bookRows: any[][] = [];
  const chapterRows: any[][] = [];
  const verseRows: any[][] = [];
  const skipped: string[] = [];

  for (const book of raw.books) {
    const resolved = resolveBook(book.name);
    if (!resolved) {
      // Deuterocanonical or unrecognized — skip but log.
      skipped.push(book.name);
      continue;
    }
    bookRows.push([
      source.key,
      resolved.slug,
      book.name.trim(),
      resolved.position,
      resolved.testament,
      book.chapters.length,
    ]);
    for (const chapter of book.chapters) {
      chapterRows.push([source.key, resolved.slug, chapter.chapter, chapter.verses.length]);
      for (const verse of chapter.verses) {
        if (!verse.text || verse.verse == null) continue;
        verseRows.push([source.key, resolved.slug, chapter.chapter, verse.verse, verse.text.trim()]);
      }
    }
  }

  console.log(`  inserting: ${bookRows.length} books, ${chapterRows.length} chapters, ${verseRows.length} verses`);
  const t2 = Date.now();

  // DO UPDATE so re-seeding picks up any text/metadata refresh from
  // upstream. Without this the seed is silently a no-op on re-runs.
  await batchInsert(
    client,
    `INSERT INTO public.bible_books (translation, slug, display_name, position, testament, chapter_count)`,
    bookRows, 6,
    `ON CONFLICT (translation, slug) DO UPDATE SET
       display_name  = EXCLUDED.display_name,
       position      = EXCLUDED.position,
       testament     = EXCLUDED.testament,
       chapter_count = EXCLUDED.chapter_count`,
  );
  await batchInsert(
    client,
    `INSERT INTO public.bible_chapter_lengths (translation, book_slug, chapter, verse_count)`,
    chapterRows, 4,
    `ON CONFLICT (translation, book_slug, chapter) DO UPDATE SET
       verse_count = EXCLUDED.verse_count`,
  );
  await batchInsert(
    client,
    `INSERT INTO public.bible_verses (translation, book_slug, chapter, verse, text)`,
    verseRows, 5,
    `ON CONFLICT (translation, book_slug, chapter, verse) DO UPDATE SET
       text = EXCLUDED.text`,
  );

  const t3 = Date.now();
  console.log(`  inserted in ${t3 - t2}ms`);
  if (skipped.length) console.log(`  skipped ${skipped.length} non-canonical books: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''}`);

  return { books: bookRows.length, chapters: chapterRows.length, verses: verseRows.length, skipped };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = new Client(DB_CONFIG);
  await client.connect();
  console.log('connected to prod DB');

  const summary: Array<{ translation: string; books: number; verses: number }> = [];

  for (const source of SOURCES) {
    console.log(`\n=== ${source.key.toUpperCase()} (${source.filename}) ===`);
    try {
      const result = await ingestTranslation(client, source);
      summary.push({ translation: source.key, books: result.books, verses: result.verses });
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
      summary.push({ translation: source.key, books: 0, verses: 0 });
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const s of summary) {
    console.log(`  ${s.translation.padEnd(10)} ${s.books.toString().padStart(3)} books, ${s.verses.toString().padStart(6)} verses`);
  }

  const total = await client.query(`SELECT COUNT(*)::int AS n FROM public.bible_verses`);
  console.log(`\n  TOTAL bible_verses rows in DB: ${total.rows[0].n}`);

  await client.end();
  console.log('done');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
