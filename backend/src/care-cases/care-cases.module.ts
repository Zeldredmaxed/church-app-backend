import { Module } from '@nestjs/common';
import { CareCasesController } from './care-cases.controller';
import { CareCasesService } from './care-cases.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [CareCasesController],
  providers: [CareCasesService, RlsContextInterceptor],
})
export class CareCasesModule {}
