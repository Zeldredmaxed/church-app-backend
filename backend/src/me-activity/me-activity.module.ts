import { Module } from '@nestjs/common';
import { MeActivityController } from './me-activity.controller';
import { MeActivityService } from './me-activity.service';

@Module({
  controllers: [MeActivityController],
  providers: [MeActivityService],
})
export class MeActivityModule {}
