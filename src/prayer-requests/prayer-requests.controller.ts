import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { PrayerRequestsService } from './prayer-requests.service';
import { CreatePrayerRequestDto } from './dto/create-prayer-request.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('prayer-requests')
export class PrayerRequestsController {
  constructor(private readonly prayerRequestsService: PrayerRequestsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createPrayerRequestDto: CreatePrayerRequestDto) {
    return this.prayerRequestsService.create(createPrayerRequestDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.prayerRequestsService.findAll();
  }

  @Post(':id/pray')
  @UseGuards(JwtAuthGuard)
  async togglePray(@Param('id') id: string, @Body('userId') userId: string) {
    return this.prayerRequestsService.togglePray(id, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    // Removed the "+" to keep it as a string UUID
    return this.prayerRequestsService.remove(id);
  }
}
