import { Module } from '@nestjs/common';
import { MemberProfilesController } from './member-profiles.controller';
import { MemberProfilesService } from './member-profiles.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [MemberProfilesController],
  providers: [MemberProfilesService, RlsContextInterceptor],
})
export class MemberProfilesModule {}
