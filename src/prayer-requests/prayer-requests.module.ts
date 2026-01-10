import { Module } from '@nestjs/common';
import { PrayerRequestsService } from './prayer-requests.service';
import { PrayerRequestsController } from './prayer-requests.controller';

@Module({
  controllers: [PrayerRequestsController],
  providers: [PrayerRequestsService],
})
export class PrayerRequestsModule {}
