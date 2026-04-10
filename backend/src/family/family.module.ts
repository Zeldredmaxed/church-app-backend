import { Module } from '@nestjs/common';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [FamilyController],
  providers: [FamilyService, RlsContextInterceptor],
})
export class FamilyModule {}
