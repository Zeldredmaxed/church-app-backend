import {
  Injectable,
  Logger,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../common/services/cache.service';
import {
  BIBLE_BOOKS,
  BibleBook,
  findBook,
  SupportedTranslation,
} from './bible-books';

export interface BiblePassage {
  ref: string;
  verse: number;
  text: string;
}

interface FetchPassageInput {
  translation: SupportedTranslation;
  book: string;
  chapter: number;
  start: number;
  /** null = "to end of chapter". Service caps gracefully. */
  end: number | null;
}

/**
 * Bible passage lookup.
 *
 * Migration 099 self-hosted 7 public-domain translations (KJV, ASV, BBE,
 * Darby, DRA, WBT, YLT) — those reads hit the local Postgres tables
 * `bible_verses`/`bible_books`/`bible_chapter_lengths` with sub-20ms
 * latency, no upstream dependency, no rate limit. WEB stays on the
 * bible-api.com proxy as a fallback (scrollmapper's bulk JSON doesn't
 * include it — follow-up seeding work).
 *
 * Cache: local reads don't need caching (Postgres is already <10ms);
 * upstream reads cache at the WHOLE-chapter level for 1h so different
 * verse windows share entries.
 */
@Injectable()
export class BibleService {
  private readonly logger = new Logger(BibleService.name);
  private readonly upstreamBase = 'https://bible-api.com';
  private readonly cacheTtlSeconds = 3600;

  /** Translations whose verses live in our local DB (migration 099). */
  private readonly SELF_HOSTED: ReadonlySet<SupportedTranslation> = new Set([
    'kjv', 'asv', 'bbe', 'darby', 'dra', 'wbt', 'ylt',
  ]);

  constructor(
    private readonly cache: CacheService,
    private readonly dataSource: DataSource,
  ) {}

  /** Static — the 66 books and their chapter counts. */
  listBooks(): ReadonlyArray<BibleBook> {
    return BIBLE_BOOKS;
  }

  /**
   * Fetches a verse range. Routes to local SQL for self-hosted
   * translations; falls back to the proxy for WEB (and any future
   * non-self-hosted translation). Returns the passages in the shape
   * the mobile UI expects: { ref, verse, text } where ref is the
   * human-readable reference (e.g., "John 3:16").
   */
  async getPassage(input: FetchPassageInput): Promise<BiblePassage[]> {
    const book = findBook(input.book);
    if (!book) {
      throw new BadRequestException(`Unknown book: ${input.book}`);
    }
    if (input.chapter < 1 || input.chapter > book.chapters) {
      throw new BadRequestException(
        `${book.name} only has ${book.chapters} chapter(s); got ${input.chapter}`,
      );
    }

    if (this.SELF_HOSTED.has(input.translation)) {
      return this.fetchFromLocal(book, input);
    }
    return this.fetchFromUpstreamCached(book, input);
  }

  // ──────────────────── Local (self-hosted) path ────────────────────

  /**
   * Direct Postgres query on bible_verses. Slicing to start..end +
   * graceful overshoot capping happen in SQL (no need to fetch the
   * whole chapter and filter in JS — the PK index covers this range
   * efficiently).
   */
  private async fetchFromLocal(
    book: BibleBook,
    input: FetchPassageInput,
  ): Promise<BiblePassage[]> {
    const bookSlug = book.name.toLowerCase().replace(/\s+/g, '-');
    // Cap end to the chapter's actual verse count — Bug 2 fix is now
    // a single SUBQUERY against bible_chapter_lengths (faster than the
    // proxy's whole-chapter fetch).
    const [lengthRow] = await this.dataSource.query(
      `SELECT verse_count FROM public.bible_chapter_lengths
       WHERE translation = $1 AND book_slug = $2 AND chapter = $3`,
      [input.translation, bookSlug, input.chapter],
    );
    if (!lengthRow) {
      // Defensive: chapter validated against static BIBLE_BOOKS above,
      // but if the seed somehow missed this row for this translation
      // we shouldn't expose internal architecture ("not seeded for X")
      // to public callers. Log server-side so ops can see the gap +
      // return the same shape the proxy would return for a 404.
      this.logger.error(
        `Local seed missing chapter ${book.name} ${input.chapter} for translation ${input.translation}`,
      );
      throw new BadRequestException('Passage not found');
    }
    const maxVerse: number = lengthRow.verse_count;
    const startCapped = Math.max(input.start, 1);
    const endCapped = input.end == null ? maxVerse : Math.min(input.end, maxVerse);

    if (endCapped < startCapped) return [];

    const rows = await this.dataSource.query(
      `SELECT verse, text FROM public.bible_verses
       WHERE translation = $1 AND book_slug = $2 AND chapter = $3
         AND verse BETWEEN $4 AND $5
       ORDER BY verse ASC`,
      [input.translation, bookSlug, input.chapter, startCapped, endCapped],
    );

    return rows.map((r: any) => ({
      ref: `${book.name} ${input.chapter}:${r.verse}`,
      verse: r.verse,
      text: r.text,
    }));
  }

  // ─────────────────────── Upstream proxy path ──────────────────────
  //
  // Used only for translations not in SELF_HOSTED (currently just WEB).
  // Caches the WHOLE chapter so different verse windows on the same
  // chapter share one cache entry. Same shape as the local path so the
  // controller doesn't need to care which backend served the read.

  private async fetchFromUpstreamCached(
    book: BibleBook,
    input: FetchPassageInput,
  ): Promise<BiblePassage[]> {
    const cacheKey = [
      'bible',
      input.translation,
      book.name.toLowerCase().replace(/\s+/g, '+'),
      input.chapter,
    ].join(':');

    const chapter = await this.cache.wrap(cacheKey, this.cacheTtlSeconds, () =>
      this.fetchWholeChapterFromUpstream(book.name, input.translation, input.chapter),
    );

    if (chapter.length === 0) {
      throw new BadRequestException('No verses found in this chapter');
    }

    const maxVerse = chapter[chapter.length - 1].verse;
    const startCapped = Math.max(input.start, 1);
    const endCapped = input.end == null ? maxVerse : Math.min(input.end, maxVerse);
    return chapter.filter((p) => p.verse >= startCapped && p.verse <= endCapped);
  }

  /**
   * Single upstream call for the WHOLE chapter. Kept private so the
   * cache wrap is the only call-path — prevents accidental cache bypass.
   */
  private async fetchWholeChapterFromUpstream(
    canonicalBookName: string,
    translation: SupportedTranslation,
    chapter: number,
  ): Promise<BiblePassage[]> {
    const bookSlug = encodeURIComponent(canonicalBookName.replace(/\s+/g, '+'));
    const url = `${this.upstreamBase}/${bookSlug}+${chapter}?translation=${translation}`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`bible-api fetch failed: ${msg}`);
      throw new BadGatewayException(
        msg.includes('aborted') ? 'Bible API timed out' : 'Bible API unreachable',
      );
    }

    if (response.status === 404) {
      throw new BadRequestException('Passage not found');
    }
    if (!response.ok) {
      this.logger.warn(`bible-api ${response.status} for ${url}`);
      throw new BadGatewayException(`Bible API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      reference?: string;
      verses?: Array<{ book_name?: string; chapter?: number; verse?: number; text?: string }>;
    };

    if (!data?.verses?.length) {
      return [];
    }

    return data.verses.map((v) => ({
      // Always use OUR canonical book name (not v.book_name) so the
      // ref string format matches the local path exactly. Mobile can
      // safely parse `ref` knowing both paths emit the same template:
      //   "{OurCanonicalName} {chapter}:{verse}"
      ref: `${canonicalBookName} ${v.chapter ?? chapter}:${v.verse ?? 0}`,
      verse: v.verse ?? 0,
      text: (v.text ?? '').trim(),
    }));
  }
}
