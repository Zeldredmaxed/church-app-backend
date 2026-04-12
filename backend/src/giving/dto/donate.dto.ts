import { IsNumber, IsPositive, IsString, IsIn, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DonateDto {
  @ApiProperty({ example: 100, minimum: 1, maximum: 999999, description: 'Donation amount in dollars (e.g., 100 = $100.00)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(1)
  @Max(999_999)
  amount: number;

  @ApiPropertyOptional({ enum: ['usd', 'eur', 'gbp', 'cad', 'aud'], default: 'usd' })
  @IsString()
  @IsIn(['usd', 'eur', 'gbp', 'cad', 'aud'], {
    message: 'currency must be one of: usd, eur, gbp, cad, aud',
  })
  currency: string = 'usd';
}
