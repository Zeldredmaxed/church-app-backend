import {
  Injectable,
  Logger,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
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
 * Thin proxy to bible-api.com (public, key-less, immutable content).
 *
 * Cache strategy: passages are immutable scripture — once fetched we can
 * cache them effectively forever, but we use 1h to allow upstream
 * corrections (typos, etc.) to propagate without an out-of-band purge.
 */
@Injectable()
export class BibleService {
  private readonly logger = new Logger(BibleService.name);
  private readonly upstreamBase = 'https://bible-api.com';
  private readonly cacheTtlSeconds = 3600;

  constructor(private readonly cache: CacheService) {}

  /** Static — the 66 books and their chapter counts. */
  listBooks(): ReadonlyArray<BibleBook> {
    return BIBLE_BOOKS;
  }

  /**
   * Fetches a verse range from bible-api.com (cached). Returns the
   * passages in the shape the mobile UI expects: { ref, verse, text }
   * where ref is the human-readable reference (e.g., "John 3:16").
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

    // Always fetch + cache the WHOLE chapter, then slice locally to
    // start..end. Two wins from this approach (vs caching per range):
    //   1. Fixes Bug 2 (overshoot 400s) — we always know the chapter's
    //      max verse count after fetching, so `end > maxVerse` gracefully
    //      caps to maxVerse instead of bubbling up the upstream 400.
    //   2. Cache hit rate goes up — different (start, end) windows on
    //      the same chapter all share one cache entry. A user reading
    //      John 3:1-10 then John 3:11-36 makes one upstream call total.
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

    // Cap end to the chapter's actual max verse — fixes Bug 2.
    const maxVerse = chapter[chapter.length - 1].verse;
    const startCapped = Math.max(input.start, 1);
    const endCapped = input.end == null ? maxVerse : Math.min(input.end, maxVerse);

    return chapter.filter((p) => p.verse >= startCapped && p.verse <= endCapped);
  }

  /**
   * Single upstream call for the WHOLE chapter. Kept private so the
   * cache wrap is the only call-path — prevents accidental cache bypass.
   *
   * URL pattern: bible-api.com accepts `/<book>+<chapter>?translation=<t>`
   * (no verse range) and returns every verse in the chapter.
   *
   * Response shape:
   *   { reference, verses: [{ book_id, book_name, chapter, verse, text }], ... }
   */
  private async fetchWholeChapterFromUpstream(
    canonicalBookName: string,
    translation: SupportedTranslation,
    chapter: number,
  ): Promise<BiblePassage[]> {
    const bookSlug = encodeURIComponent(canonicalBookName.replace(/\s+/g, '+'));
    const url = `${this.upstreamBase}/${bookSlug}+${chapter}?translation=${translation}`;

    // 5-second timeout. Undici's default is no timeout — without this
    // a hung upstream (bible-api is a free single-maintainer service)
    // pins an event-loop slot indefinitely. AbortError → 502.
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
      // Upstream returns 200 with empty verses for unknown chapters.
      return [];
    }

    return data.verses.map((v) => ({
      ref: `${v.book_name ?? canonicalBookName} ${v.chapter ?? chapter}:${v.verse ?? 0}`,
      verse: v.verse ?? 0,
      text: (v.text ?? '').trim(),
    }));
  }
}
