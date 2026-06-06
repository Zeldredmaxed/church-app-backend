import { IsNumber, Min, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecurringGiftDto {
  @ApiProperty({ example: 50, description: 'Amount in dollars (server converts to cents)' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'usd' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 'monthly', enum: ['weekly', 'biweekly', 'monthly'] })
  @IsIn(['weekly', 'biweekly', 'monthly'])
  frequency: 'weekly' | 'biweekly' | 'monthly';

  @ApiPropertyOptional({ example: 'General Fund' })
  @IsOptional()
  @IsString()
  fundName?: string;

  @ApiProperty({
    example: 'pm_1NXabc...',
    description:
      "Stripe payment method id the donor selected. Obtain via the existing SetupIntent + Stripe Elements flow on POST /api/stripe/connect/setup-intent.",
  })
  @IsString()
  paymentMethodId: string;
}
