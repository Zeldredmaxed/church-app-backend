import { IsInt, IsOptional, IsString, IsBoolean, MaxLength, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDonationDto {
  @ApiProperty({ example: 10000, minimum: 100, maximum: 99999999, description: 'Donation amount in cents (minimum $1.00 = 100, maximum $999,999.99 = 99999999)' })
  @IsInt()
  @Min(100)
  @Max(99_999_999)
  amount: number;

  @ApiPropertyOptional({ example: 'Keep up the great work!', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @ApiPropertyOptional({ default: false, description: 'If true, donor name is hidden from backers list' })
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @ApiPropertyOptional({ description: 'Stripe payment method ID (pm_xxx). If omitted, returns client_secret for frontend confirmation.' })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
