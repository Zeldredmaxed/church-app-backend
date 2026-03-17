import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionStatusService } from './subscription-status.service';
import { SubscriptionStatusController } from './subscription-status.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [SubscriptionsController, SubscriptionStatusController],
  providers: [SubscriptionsService, SubscriptionStatusService, PrismaService],
})
export class SubscriptionsModule {}
