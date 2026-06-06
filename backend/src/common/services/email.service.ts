import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Resend wrapper for transactional emails (invitations, magic links,
 * dunning, password resets).
 *
 * Configured via env:
 *   RESEND_API_KEY      — Resend API token (re_...)
 *   RESEND_FROM         — verified from address (e.g. "Shepard <noreply@shepard.love>")
 *   RESEND_REPLY_TO     — optional reply-to address
 *
 * If RESEND_API_KEY is missing, the service logs the email payload at
 * INFO level instead of sending — useful in dev. Production should
 * always set the key; absence is logged at WARN.
 *
 * Deliverability prerequisites (DNS-side, NOT in code):
 *   - Sending domain verified in Resend dashboard
 *   - SPF record: v=spf1 include:spf.resend.com -all
 *   - DKIM CNAMEs from Resend dashboard
 *   - DMARC: v=DMARC1; p=quarantine; rua=mailto:dmarc@shepard.love
 *   - Optional: BIMI for brand logo in inboxes
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly fromAddress: string;
  private readonly replyTo: string | undefined;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.fromAddress = config.get<string>('RESEND_FROM') ?? 'Shepard <noreply@shepard.love>';
    this.replyTo = config.get<string>('RESEND_REPLY_TO');
    if (apiKey) {
      this.client = new Resend(apiKey);
    } else {
      this.client = null;
      this.logger.warn(
        'RESEND_API_KEY missing — emails will be logged to console instead of sent. Set the env var in production.',
      );
    }
  }

  /**
   * Send a transactional email. Returns { id } from Resend on success
   * or { id: null, error } on failure (also logged). Never throws —
   * email send failures should not break the caller's flow (the
   * invitation row is persisted whether or not the email lands).
   */
  async send(args: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    tags?: Array<{ name: string; value: string }>;
  }): Promise<{ id: string | null; error?: string }> {
    if (!this.client) {
      // Dev / missing-key path — log instead of send.
      this.logger.log(
        `[EMAIL DRY-RUN] to=${args.to} subject="${args.subject}" tags=${JSON.stringify(args.tags ?? [])}`,
      );
      this.logger.debug(`[EMAIL DRY-RUN BODY] ${args.text ?? args.html.slice(0, 500)}`);
      return { id: null };
    }

    try {
      const res = await this.client.emails.send({
        from: this.fromAddress,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        replyTo: this.replyTo,
        tags: args.tags,
      });
      if (res.error) {
        this.logger.error(`Resend send failed to ${args.to}: ${res.error.message}`);
        return { id: null, error: res.error.message };
      }
      this.logger.log(`Email sent id=${res.data?.id} to=${args.to} subject="${args.subject}"`);
      return { id: res.data?.id ?? null };
    } catch (err: any) {
      this.logger.error(`Resend exception to ${args.to}: ${err.message}`);
      return { id: null, error: err.message };
    }
  }
}

/**
 * Global module — EmailService is available without explicit import
 * (like SupabaseAdminModule). Most domains need to fire transactional
 * emails (auth, billing, invitations, dunning) and circular-import
 * gymnastics aren't worth the friction.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
