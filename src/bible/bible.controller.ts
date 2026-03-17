import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { BibleService } from './bible.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bible')
export class BibleController {
  constructor(private readonly bibleService: BibleService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: { book: string; chapter: number; verse: number; note?: string }) {
    return this.bibleService.create(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.bibleService.findAll();
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.bibleService.remove(id);
  }
}
