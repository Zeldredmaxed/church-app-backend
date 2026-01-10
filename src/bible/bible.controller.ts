import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { BibleService } from './bible.service';

@Controller('bible')
export class BibleController {
  constructor(private readonly bibleService: BibleService) {}

  @Post()
  create(@Body() body: { book: string; chapter: number; verse: number; note?: string }) {
    return this.bibleService.create(body);
  }

  @Get()
  findAll() {
    return this.bibleService.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bibleService.remove(id);
  }
}
