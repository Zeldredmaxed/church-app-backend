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
  end: number;
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

    // Use the canonical (correctly-cased) book name in the cache key
    // so different casings of the same book collapse to one entry.
    const cacheKey = [
      'bible',
      input.translation,
      book.name.toLowerCase().replace(/\s+/g, '+'),
      input.chapter,
      input.start,
      input.end,
    ].join(':');

    return this.cache.wrap(cacheKey, this.cacheTtlSeconds, () =>
      this.fetchFromUpstream(book.name, input),
    );
  }

  /**
   * Single upstream call. Kept private so the cache wrap is the only
   * call-path — prevents accidental cache bypass.
   *
   * bible-api response shape:
   *   { reference, verses: [{ book_id, book_name, chapter, verse, text }], ... }
   */
  private async fetchFromUpstream(
    canonicalBookName: string,
    input: FetchPassageInput,
  ): Promise<BiblePassage[]> {
    const bookSlug = encodeURIComponent(canonicalBookName.replace(/\s+/g, '+'));
    const range =
      input.start === input.end
        ? `${input.chapter}:${input.start}`
        : `${input.chapter}:${input.start}-${input.end}`;
    const url = `${this.upstreamBase}/${bookSlug}+${encodeURIComponent(range)}?translation=${input.translation}`;

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
      // Upstream returns 200 with empty verses for out-of-range requests
      // (e.g., John 3:200). Map that to a clean 400 for the client.
      throw new BadRequestException('No verses in requested range');
    }

    return data.verses.map((v) => ({
      ref: `${v.book_name ?? canonicalBookName} ${v.chapter ?? input.chapter}:${v.verse ?? input.start}`,
      verse: v.verse ?? input.start,
      text: (v.text ?? '').trim(),
    }));
  }
}
