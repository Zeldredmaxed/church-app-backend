import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFundDto {
  @ApiProperty({ example: 'Building Fund', description: 'Name of the giving fund' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Fund for new church building', description: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string;
}
