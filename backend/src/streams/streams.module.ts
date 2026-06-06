import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { MediaModule } from '../media/media.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [MediaModule, AuditModule],
  controllers: [StreamsController],
  providers: [StreamsService, RlsContextInterceptor],
})
export class StreamsModule {}
