import { Module } from '@nestjs/common';
import { PrayersController } from './prayers.controller';
import { PrayersService } from './prayers.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [PrayersController],
  providers: [PrayersService, RlsContextInterceptor],
})
export class PrayersModule {}
