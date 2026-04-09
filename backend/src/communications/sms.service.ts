import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

/**
 * SMS delivery service powered by Twilio.
 *
 * Sends text messages to church members' phone numbers.
 *
 * Setup:
 *   1. Create a Twilio account at twilio.com
 *   2. Buy a phone number (~$1.15/month)
 *   3. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in env vars
 *
 * Cost: ~$0.0079 per outbound SMS in the US.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_PHONE_NUMBER', '');

    if (accountSid && authToken && !accountSid.includes('placeholder')) {
      this.client = new Twilio(accountSid, authToken);
    } else {
      this.client = null;
      this.logger.warn('Twilio not configured — SMS sending disabled');
    }
  }

  /**
   * Send an SMS to one or more phone numbers.
   * Twilio sends one message at a time, so we loop.
   */
  async sendSms(
    phoneNumbers: string[],
    body: string,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.client) {
      this.logger.debug(`[SMS STUB] Would send to ${phoneNumbers.length} numbers: ${body.slice(0, 50)}...`);
      return { sent: phoneNumbers.length, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const to of phoneNumbers) {
      try {
        await this.client.messages.create({
          to,
          from: this.fromNumber,
          body,
        });
        sent++;
      } catch (err: any) {
        failed++;
        this.logger.error(`SMS to ${to} failed: ${err.message}`);
      }
    }

    this.logger.log(`SMS batch complete: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }
}
