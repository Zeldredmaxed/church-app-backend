import { IsNumber, IsPositive, IsString, IsIn, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DonateDto {
  @ApiProperty({ example: 100, minimum: 1, description: 'Donation amount in dollars (e.g., 100 = $100.00)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ enum: ['usd', 'eur', 'gbp', 'cad', 'aud'], default: 'usd' })
  @IsString()
  @IsIn(['usd', 'eur', 'gbp', 'cad', 'aud'], {
    message: 'currency must be one of: usd, eur, gbp, cad, aud',
  })
  currency: string = 'usd';
}
