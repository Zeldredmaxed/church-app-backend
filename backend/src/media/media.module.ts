import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { TierCheckService } from '../common/services/tier-check.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, TierCheckService, StorageService],
  exports: [MediaService, StorageService],
})
export class MediaModule {}
