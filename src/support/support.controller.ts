import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  create(@Body() body: { type: string; message: string; userId: string }) {
    return this.supportService.create(body);
  }

  @Get()
  findAll() {
    return this.supportService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { status: string }) {
    return this.supportService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.supportService.remove(id);
  }
}
