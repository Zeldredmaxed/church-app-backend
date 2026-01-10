import { Module } from '@nestjs/common';
import { BibleService } from './bible.service';
import { BibleController } from './bible.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BibleController],
  providers: [BibleService],
})
export class BibleModule {}
