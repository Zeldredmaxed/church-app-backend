import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [GroupsController],
  providers: [GroupsService, RlsContextInterceptor],
})
export class GroupsModule {}
