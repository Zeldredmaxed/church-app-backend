import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    AuditModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService, RlsContextInterceptor],
})
export class CommentsModule {}
