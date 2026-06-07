import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IosWaitlistController } from './ios-waitlist.controller';
import { IosWaitlistService } from './ios-waitlist.service';
import { IosWaitlistEntry } from './entities/ios-waitlist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([IosWaitlistEntry])],
  controllers: [IosWaitlistController],
  providers: [IosWaitlistService],
})
export class IosWaitlistModule {}
