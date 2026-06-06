/**
 * Canonical list of the 66 Protestant Bible books with chapter counts.
 *
 * Static — chapter counts have not changed in 1700+ years. This is the
 * source of truth used by:
 *   - GET /api/bible/books (returns directly)
 *   - GET /api/bible passage validation (book name lookup, case-insensitive)
 *
 * Names match bible-api.com's expected slugs (lowercase, '+'-separated
 * in the URL — we lower-case the input and let the URL builder handle
 * spaces with +).
 */
export interface BibleBook {
  name: string;
  chapters: number;
}

export const BIBLE_BOOKS: ReadonlyArray<BibleBook> = [
  // Old Testament
  { name: 'Genesis', chapters: 50 },
  { name: 'Exodus', chapters: 40 },
  { name: 'Leviticus', chapters: 27 },
  { name: 'Numbers', chapters: 36 },
  { name: 'Deuteronomy', chapters: 34 },
  { name: 'Joshua', chapters: 24 },
  { name: 'Judges', chapters: 21 },
  { name: 'Ruth', chapters: 4 },
  { name: '1 Samuel', chapters: 31 },
  { name: '2 Samuel', chapters: 24 },
  { name: '1 Kings', chapters: 22 },
  { name: '2 Kings', chapters: 25 },
  { name: '1 Chronicles', chapters: 29 },
  { name: '2 Chronicles', chapters: 36 },
  { name: 'Ezra', chapters: 10 },
  { name: 'Nehemiah', chapters: 13 },
  { name: 'Esther', chapters: 10 },
  { name: 'Job', chapters: 42 },
  { name: 'Psalms', chapters: 150 },
  { name: 'Proverbs', chapters: 31 },
  { name: 'Ecclesiastes', chapters: 12 },
  { name: 'Song of Solomon', chapters: 8 },
  { name: 'Isaiah', chapters: 66 },
  { name: 'Jeremiah', chapters: 52 },
  { name: 'Lamentations', chapters: 5 },
  { name: 'Ezekiel', chapters: 48 },
  { name: 'Daniel', chapters: 12 },
  { name: 'Hosea', chapters: 14 },
  { name: 'Joel', chapters: 3 },
  { name: 'Amos', chapters: 9 },
  { name: 'Obadiah', chapters: 1 },
  { name: 'Jonah', chapters: 4 },
  { name: 'Micah', chapters: 7 },
  { name: 'Nahum', chapters: 3 },
  { name: 'Habakkuk', chapters: 3 },
  { name: 'Zephaniah', chapters: 3 },
  { name: 'Haggai', chapters: 2 },
  { name: 'Zechariah', chapters: 14 },
  { name: 'Malachi', chapters: 4 },
  // New Testament
  { name: 'Matthew', chapters: 28 },
  { name: 'Mark', chapters: 16 },
  { name: 'Luke', chapters: 24 },
  { name: 'John', chapters: 21 },
  { name: 'Acts', chapters: 28 },
  { name: 'Romans', chapters: 16 },
  { name: '1 Corinthians', chapters: 16 },
  { name: '2 Corinthians', chapters: 13 },
  { name: 'Galatians', chapters: 6 },
  { name: 'Ephesians', chapters: 6 },
  { name: 'Philippians', chapters: 4 },
  { name: 'Colossians', chapters: 4 },
  { name: '1 Thessalonians', chapters: 5 },
  { name: '2 Thessalonians', chapters: 3 },
  { name: '1 Timothy', chapters: 6 },
  { name: '2 Timothy', chapters: 4 },
  { name: 'Titus', chapters: 3 },
  { name: 'Philemon', chapters: 1 },
  { name: 'Hebrews', chapters: 13 },
  { name: 'James', chapters: 5 },
  { name: '1 Peter', chapters: 5 },
  { name: '2 Peter', chapters: 3 },
  { name: '1 John', chapters: 5 },
  { name: '2 John', chapters: 1 },
  { name: '3 John', chapters: 1 },
  { name: 'Jude', chapters: 1 },
  { name: 'Revelation', chapters: 22 },
];

/** Lowercased name → canonical book entry. Built once at module load. */
const BOOK_LOOKUP = new Map<string, BibleBook>(
  BIBLE_BOOKS.map((b) => [b.name.toLowerCase(), b]),
);

/**
 * Case-insensitive lookup. Returns the canonical BibleBook entry or
 * undefined if the input isn't one of the 66 books.
 */
export function findBook(name: string): BibleBook | undefined {
  return BOOK_LOOKUP.get(name.trim().toLowerCase());
}

/**
 * Translations supported by bible-api.com. Validated server-side before
 * the upstream call so we fail-fast on typos and never burn an HTTP
 * round-trip on an unsupported translation.
 *
 * Note: 'esv' is requested by mobile but is NOT supported by bible-api
 * (it's copyrighted and excluded). We allow the supported set only and
 * the controller returns 400 for anything else (including 'esv').
 */
export const SUPPORTED_TRANSLATIONS = [
  'kjv',
  'web',
  'asv',
  'bbe',
  'darby',
  'dra',
  'wbt',
  'ylt',
] as const;

export type SupportedTranslation = (typeof SUPPORTED_TRANSLATIONS)[number];
