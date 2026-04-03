import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FeedResolver } from './feed.resolver';
import { FeedService } from './feed.service';
import { SocialFanoutProcessor } from './social-fanout.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'social-fanout' }),
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [FeedResolver, FeedService, SocialFanoutProcessor],
  exports: [FeedService],
})
export class FeedModule {}
