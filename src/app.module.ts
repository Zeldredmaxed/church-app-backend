import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { TagsModule } from './tags/tags.module';
import { DonationsModule } from './donations/donations.module';
import { MediaModule } from './media/media.module';
import { PrismaService } from './prisma/prisma.service';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrayerRequestsModule } from './prayer-requests/prayer-requests.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { FeedModule } from './feed/feed.module';
import { BibleModule } from './bible/bible.module';
import { AiModule } from './ai/ai.module';
import { AdminAgentModule } from './admin-agent/admin-agent.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    UsersModule, 
    AuthModule, 
    EventsModule, 
    TagsModule, 
    DonationsModule, 
    MediaModule, ChatModule, NotificationsModule, PrismaModule, AnnouncementsModule, PrayerRequestsModule, SystemSettingsModule, FeedModule, BibleModule, AiModule, AdminAgentModule, SupportModule
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}