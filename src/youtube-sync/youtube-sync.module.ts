import { Module } from '@nestjs/common';
import { YouTubeSyncService } from './youtube-sync.service';
import { YouTubeSyncController } from './youtube-sync.controller';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [YouTubeSyncController],
  providers: [YouTubeSyncService, PrismaService],
  exports: [YouTubeSyncService],
})
export class YouTubeSyncModule {}
