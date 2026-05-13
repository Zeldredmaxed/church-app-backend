import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { MemberTagsController } from './member-tags.controller';
import { TagsService } from './tags.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [TagsController, MemberTagsController],
  providers: [TagsService, RlsContextInterceptor],
})
export class TagsModule {}
