import { IsInt, IsOptional, IsString, IsBoolean, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDonationDto {
  @ApiProperty({ example: 10000, description: 'Donation amount in cents (minimum $1.00 = 100)' })
  @IsInt()
  @Min(100)
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
