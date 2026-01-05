import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { TagsModule } from './tags/tags.module';
import { DonationsModule } from './donations/donations.module';
import { MediaModule } from './media/media.module';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    UsersModule, 
    AuthModule, 
    EventsModule, 
    TagsModule, 
    DonationsModule, 
    MediaModule // <--- MAKE SURE THIS IS HERE!
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}