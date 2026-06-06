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
 * Public Bible passage proxy.
 *
 * No JwtAuthGuard — scripture is public. Throttled to 60/min per client
 * to prevent abuse since the upstream (bible-api.com) is also unauthed
 * and we don't want to look like a botnet to them.
 */
@ApiTags('Bible')
@Controller('bible')
@Throttle({ default: { ttl: 60_000, limit: 60 } })
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
    summary: 'Fetch a passage from bible-api.com (cached 1h)',
    description:
      'Returns { passages: [{ ref, verse, text }] }. All four range ' +
      'params (translation, book, chapter, start) are required; end ' +
      'defaults to start (single-verse).',
  })
  @ApiQuery({ name: 'translation', required: true, enum: SUPPORTED_TRANSLATIONS })
  @ApiQuery({ name: 'book', required: true, example: 'john' })
  @ApiQuery({ name: 'chapter', required: true, example: 3 })
  @ApiQuery({ name: 'start', required: true, example: 1 })
  @ApiQuery({ name: 'end', required: false, example: 16 })
  @ApiResponse({ status: 200, description: '{ passages: BiblePassage[] }' })
  @ApiResponse({ status: 400, description: 'Invalid translation / book / chapter / verse range' })
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
    if (start == null) throw new BadRequestException('start is required');

    const t = this.assertTranslation(translation);
    const chapterNum = this.parsePositiveInt(chapter, 'chapter');
    const startNum = this.parsePositiveInt(start, 'start');
    const endNum = end == null ? startNum : this.parsePositiveInt(end, 'end');
    if (endNum < startNum) {
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
