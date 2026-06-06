import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BibleService, BiblePassage } from './bible.service';
import {
  SUPPORTED_TRANSLATIONS,
  SupportedTranslation,
  BibleBook,
} from './bible-books';

/**
 * Public Bible passage endpoint.
 *
 * No JwtAuthGuard — scripture is public. Migration 099 self-hosted 7
 * of 8 translations into local Postgres, so most reads are now sub-20ms
 * and have no upstream dependency.
 *
 * Throttle: 120/min per IP. We bumped from the original 60/min (which
 * was protecting bible-api.com upstream) but kept it tight because the
 * endpoint is unauthed — a generous limit on a public unauthed read
 * is DoS-friendly from a botnet. 120/min comfortably handles a real
 * member's reading pace (one chapter every 30s sustained, or bursts
 * of full chapter flips) without leaving the door wide open.
 */
@ApiTags('Bible')
@Controller('bible')
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class BibleController {
  constructor(private readonly bibleService: BibleService) {}

  @Get('books')
  @ApiOperation({
    summary: 'List the 66 canonical books with chapter counts',
    description:
      'Static — chapter counts are immutable. The `translation` query ' +
      'param is accepted for forward-compatibility but does not affect ' +
      'the response today (all supported translations share the same ' +
      'canon and chapter count).',
  })
  @ApiQuery({ name: 'translation', required: false, enum: SUPPORTED_TRANSLATIONS })
  @ApiResponse({ status: 200, description: '{ books: Array<{ name, chapters }> }' })
  getBooks(@Query('translation') translation?: string): { books: ReadonlyArray<BibleBook> } {
    if (translation) this.assertTranslation(translation);
    return { books: this.bibleService.listBooks() };
  }

  @Get()
  @ApiOperation({
    summary: 'Fetch a Bible passage (cached 1h)',
    description:
      'Returns { passages: [{ ref, verse, text }] }. Required: translation, ' +
      'book, chapter. Optional: start (default 1), end (default = end of ' +
      'chapter). Omitting both start and end returns the entire chapter. ' +
      'Overshoots are gracefully capped to the chapter\'s last verse.',
  })
  @ApiQuery({ name: 'translation', required: true, enum: SUPPORTED_TRANSLATIONS })
  @ApiQuery({ name: 'book', required: true, example: 'john' })
  @ApiQuery({ name: 'chapter', required: true, example: 3 })
  @ApiQuery({ name: 'start', required: false, example: 1, description: 'Defaults to 1.' })
  @ApiQuery({ name: 'end', required: false, example: 16, description: 'Defaults to end of chapter. Overshoots are gracefully capped.' })
  @ApiResponse({ status: 200, description: '{ passages: BiblePassage[] }' })
  @ApiResponse({ status: 400, description: 'Invalid translation / book / chapter' })
  @ApiResponse({ status: 502, description: 'Upstream bible-api unreachable' })
  async getPassage(
    @Query('translation') translation?: string,
    @Query('book') book?: string,
    @Query('chapter') chapter?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ): Promise<{ passages: BiblePassage[] }> {
    if (!translation) throw new BadRequestException('translation is required');
    if (!book) throw new BadRequestException('book is required');
    if (chapter == null) throw new BadRequestException('chapter is required');

    const t = this.assertTranslation(translation);
    const chapterNum = this.parsePositiveInt(chapter, 'chapter');
    // start defaults to 1 — mobile's "show me this chapter" call omits it
    // (Bug 1 from mobile ticket). end defaults to null = "to end of chapter"
    // (Bug 2 — overshoots are capped server-side in the service).
    const startNum = start == null ? 1 : this.parsePositiveInt(start, 'start');
    const endNum = end == null ? null : this.parsePositiveInt(end, 'end');
    if (endNum != null && endNum < startNum) {
      throw new BadRequestException('end must be >= start');
    }

    const passages = await this.bibleService.getPassage({
      translation: t,
      book,
      chapter: chapterNum,
      start: startNum,
      end: endNum,
    });
    return { passages };
  }

  private assertTranslation(value: string): SupportedTranslation {
    const lower = value.trim().toLowerCase();
    if (!(SUPPORTED_TRANSLATIONS as readonly string[]).includes(lower)) {
      throw new BadRequestException(
        `Unsupported translation. Supported: ${SUPPORTED_TRANSLATIONS.join(', ')}`,
      );
    }
    return lower as SupportedTranslation;
  }

  private parsePositiveInt(value: string, fieldName: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }
    return n;
  }
}
