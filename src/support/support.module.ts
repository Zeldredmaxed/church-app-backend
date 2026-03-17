import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportTicketsController } from './support-tickets.controller';

@Module({
  controllers: [SupportController, SupportTicketsController],
  providers: [SupportService],
})
export class SupportModule {}
