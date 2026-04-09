import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, RlsContextInterceptor],
})
export class AnnouncementsModule {}
