import { Module } from '@nestjs/common';
import { SermonsController } from './sermons.controller';
import { SermonsService } from './sermons.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [SermonsController],
  providers: [SermonsService, RlsContextInterceptor],
})
export class SermonsModule {}
