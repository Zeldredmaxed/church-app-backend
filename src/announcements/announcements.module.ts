import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
// No need to import PrismaModule here anymore because we added @Global() to it!

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService], // <--- ADD THIS
})
export class AnnouncementsModule {}