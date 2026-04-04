import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { TierCheckService } from '../common/services/tier-check.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, TierCheckService],
  exports: [MediaService],
})
export class MediaModule {}
