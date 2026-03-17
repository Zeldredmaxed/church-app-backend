import { Module } from '@nestjs/common';
import { DonationsService } from './donations.service';
import { DonationsController } from './donations.controller';
import { DonationsWebhookController } from './donations-webhook.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [DonationsController, DonationsWebhookController],
  providers: [DonationsService, PrismaService],
})
export class DonationsModule {}