import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Payload for POST /stripe/connect/onboard.
 * The frontend provides the URLs that Stripe should redirect to
 * after the admin completes or abandons onboarding.
 */
export class OnboardConnectDto {
  @ApiProperty({ example: 'https://app.example.com/onboard', description: 'Redirect URL if onboarding link expires' })
  @IsUrl({ require_tld: false })
  refreshUrl: string;

  @ApiProperty({ example: 'https://app.example.com/dashboard', description: 'Redirect URL after onboarding completes' })
  @IsUrl({ require_tld: false })
  returnUrl: string;
}
