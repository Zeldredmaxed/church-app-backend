import { Module } from '@nestjs/common';
import { BadgesController } from './badges.controller';
import { BadgesMemberController } from './badges-member.controller';
import { BadgesService } from './badges.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [BadgesController, BadgesMemberController],
  providers: [BadgesService, RlsContextInterceptor],
  exports: [BadgesService],
})
export class BadgesModule {}
