import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [FamilyController],
  providers: [FamilyService, RlsContextInterceptor],
})
export class FamilyModule {}
