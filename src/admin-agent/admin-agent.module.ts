import { Module } from '@nestjs/common';
import { AdminAgentService } from './admin-agent.service';
import { AdminAgentController } from './admin-agent.controller';
import { UsersModule } from '../users/users.module';
import { ChatModule } from '../chat/chat.module';
import { AnnouncementsModule } from '../announcements/announcements.module';

@Module({
  imports: [UsersModule, ChatModule, AnnouncementsModule],
  controllers: [AdminAgentController],
  providers: [AdminAgentService],
})
export class AdminAgentModule {}
