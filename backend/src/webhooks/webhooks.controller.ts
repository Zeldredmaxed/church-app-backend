import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly muxWebhookSecret: string;

  constructor(private readonly config: ConfigService) {
    this.muxWebhookSecret = this.config.getOrThrow<string>('MUX_WEBHOOK_SECRET');
  }

  @Post('mux')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mux webhook receiver (HMAC-SHA256 verified, no JWT)' })
  @ApiResponse({ status: 200, description: '{ received: true }' })
  @ApiResponse({ status: 401, description: 'Invalid or missing mux-signature header' })
  async handleMuxWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ received: boolean }> {
    const signatureHeader = req.headers['mux-signature'] as string | undefined;

    if (!signatureHeader) {
      this.logger.warn('Mux webhook received without signature header');
      throw new UnauthorizedException('Missing mux-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Raw body not available. Ensure NestFactory.create has rawBody: true.',
      );
      throw new UnauthorizedException('Cannot verify signature: raw body unavailable');
    }

    const elements = signatureHeader.split(',');
    const timestampStr = elements.find(e => e.startsWith('t='))?.slice(2);
    const signatureStr = elements.find(e => e.startsWith('v1='))?.slice(3);

    if (!timestampStr || !signatureStr) {
      this.logger.warn('Mux webhook signature header malformed');
      throw new UnauthorizedException('Malformed mux-signature header');
    }

    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    const tolerance = 300;

    if (Math.abs(now - timestamp) > tolerance) {
      this.logger.warn(
        `Mux webhook timestamp too old: ${timestamp} (now: ${now}, delta: ${now - timestamp}s)`,
      );
      throw new UnauthorizedException('Webhook timestamp outside tolerance window');
    }

    const signedPayload = `${timestampStr}.${rawBody.toString('utf8')}`;
    const expectedSignature = createHmac('sha256', this.muxWebhookSecret)
      .update(signedPayload)
      .digest('hex');

    const sigBuffer = Buffer.from(signatureStr, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      this.logger.warn('Mux webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType = payload.type ?? 'unknown';

    this.logger.log(`Mux webhook received: ${eventType}`);
    this.logger.debug(`Mux webhook payload: ${JSON.stringify(payload)}`);

    return { received: true };
  }
}
