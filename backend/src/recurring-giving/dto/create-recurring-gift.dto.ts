import { IsNumber, Min, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecurringGiftDto {
  @ApiProperty({ example: 50, description: 'Amount in dollars' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'usd' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 'monthly', enum: ['weekly', 'biweekly', 'monthly'] })
  @IsIn(['weekly', 'biweekly', 'monthly'])
  frequency: string;

  @ApiPropertyOptional({ example: 'General Fund' })
  @IsOptional()
  @IsString()
  fundName?: string;
}
