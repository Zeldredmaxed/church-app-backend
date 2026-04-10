import { Module } from '@nestjs/common';
import { OnboardingAdminController, OnboardingPublicController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingAdminController, OnboardingPublicController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
