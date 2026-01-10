import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { PrayerRequestsService } from './prayer-requests.service';
import { CreatePrayerRequestDto } from './dto/create-prayer-request.dto';

@Controller('prayer-requests')
export class PrayerRequestsController {
  constructor(private readonly prayerRequestsService: PrayerRequestsService) {}

  @Post()
  create(@Body() createPrayerRequestDto: CreatePrayerRequestDto) {
    return this.prayerRequestsService.create(createPrayerRequestDto);
  }

  @Get()
  findAll() {
    return this.prayerRequestsService.findAll();
  }

  @Post(':id/pray')
  async togglePray(@Param('id') id: string, @Body('userId') userId: string) {
    return this.prayerRequestsService.togglePray(id, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    // Removed the "+" to keep it as a string UUID
    return this.prayerRequestsService.remove(id);
  }
}
