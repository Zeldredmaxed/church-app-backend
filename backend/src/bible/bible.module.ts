import { Module } from '@nestjs/common';
import { BibleController } from './bible.controller';
import { BibleService } from './bible.service';
import { CacheService } from '../common/services/cache.service';

/**
 * BibleModule — public scripture proxy.
 *
 * Wraps bible-api.com (free, key-less) behind a 1h Redis cache so we
 * never hammer the upstream and the mobile gets near-instant subsequent
 * loads of the same passage.
 */
@Module({
  controllers: [BibleController],
  providers: [BibleService, CacheService],
})
export class BibleModule {}
