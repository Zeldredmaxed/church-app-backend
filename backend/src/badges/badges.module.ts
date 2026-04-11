import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BadgesController } from './badges.controller';
import { BadgesMemberController } from './badges-member.controller';
import { BadgesService } from './badges.service';
import { CacheService } from '../common/services/cache.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [BadgesController, BadgesMemberController],
  providers: [BadgesService, CacheService, RlsContextInterceptor],
  exports: [BadgesService],
})
export class BadgesModule {}
