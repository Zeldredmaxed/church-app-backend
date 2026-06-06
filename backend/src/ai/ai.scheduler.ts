import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiService } from './ai.service';

/**
 * AI retention cron. Honors the migration 094 TTL on ai_conversations
 * so the data doesn't sit forever — contradicting the privacy policy's
 * "other personal data deleted within 30 days" commitment and exposing
 * us to GDPR Art. 5(1)(e) storage-limitation findings.
 *
 * 03:45 UTC daily. Off-cycle from the attendance ping purge (03:30) so
 * the two big DELETEs don't pile on Supabase together.
 */
@Injectable()
export class AiScheduler {
  private readonly logger = new Logger(AiScheduler.name);

  constructor(private readonly ai: AiService) {}

  @Cron('45 3 * * *')
  async tickPurgeExpired(): Promise<void> {
    try {
      const result = await this.ai.purgeExpired();
      if (result.deleted > 0) {
        this.logger.log(`Purged ${result.deleted} expired AI conversations`);
      }
    } catch (err: any) {
      this.logger.error(`AI purge failed: ${err.message}`);
    }
  }
}
