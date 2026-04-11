import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Email delivery service powered by Resend.
 *
 * Sends transactional and bulk emails to church members.
 * The "from" address uses the configured domain.
 *
 * Setup:
 *   1. Create a free account at resend.com
 *   2. Add and verify your domain (e.g., mail.shepard.com)
 *   3. Set RESEND_API_KEY and RESEND_FROM_EMAIL in env vars
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromEmail = this.config.get<string>('RESEND_FROM_EMAIL', 'noreply@shepard.app');

    if (apiKey && !apiKey.includes('placeholder')) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn('RESEND_API_KEY not configured — email sending disabled');
    }
  }

  /**
   * Send an email to one or more recipients.
   * Returns the Resend message ID on success, null on failure.
   */
  async sendEmail(
    to: string[],
    subject: string,
    body: string,
    churchName?: string,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.resend) {
      this.logger.debug(`[EMAIL STUB] Would send to ${to.length} recipients: ${subject}`);
      return { sent: to.length, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    // Resend supports up to 100 recipients per batch
    const batches = this.chunk(to, 50);

    for (const batch of batches) {
      try {
        await this.resend.emails.send({
          from: churchName
            ? `${churchName} <${this.fromEmail}>`
            : this.fromEmail,
          to: batch,
          subject,
          html: this.wrapHtml(body, churchName),
        });
        sent += batch.length;
        this.logger.log(`Email sent to ${batch.length} recipients: ${subject}`);
      } catch (err: any) {
        failed += batch.length;
        this.logger.error(`Email send failed for batch of ${batch.length}: ${err.message}`);
      }
    }

    return { sent, failed };
  }

  /** Escape HTML special characters to prevent XSS in emails. */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Wraps plain text body in a simple HTML email template. */
  private wrapHtml(body: string, churchName?: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${churchName ? `<h2 style="color: #1a1a1a; margin-bottom: 20px;">${this.escapeHtml(churchName)}</h2>` : ''}
        <div style="color: #333; line-height: 1.6; white-space: pre-wrap;">${this.escapeHtml(body)}</div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px;">
          Sent via Shepard Church Platform
        </p>
      </div>
    `;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
