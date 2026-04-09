import { Module } from '@nestjs/common';
import { VolunteerController } from './volunteer.controller';
import { VolunteerService } from './volunteer.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [VolunteerController],
  providers: [VolunteerService, RlsContextInterceptor],
})
export class VolunteerModule {}
