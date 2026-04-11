import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { CampusController } from './campus.controller';
import { CampusService } from './campus.service';
import { CacheService } from '../common/services/cache.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [TenantsController, CampusController],
  providers: [TenantsService, CampusService, CacheService, RlsContextInterceptor],
  exports: [CampusService],
})
export class TenantsModule {}
