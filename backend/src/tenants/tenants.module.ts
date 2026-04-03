import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, RlsContextInterceptor],
})
export class TenantsModule {}
