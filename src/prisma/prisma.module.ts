import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // This makes PrismaService available everywhere without re-importing it in every module
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}