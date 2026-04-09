import { IsString, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogHoursDto {
  @ApiProperty({ description: 'User UUID who volunteered' })
  @IsUUID('4')
  userId: string;

  @ApiPropertyOptional({ description: 'Optional volunteer opportunity UUID' })
  @IsOptional()
  @IsUUID('4')
  opportunityId?: string;

  @ApiProperty({ example: 4.5, minimum: 0.25, description: 'Number of hours volunteered' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  hours: number;

  @ApiProperty({ example: '2026-04-08', description: 'Date of volunteer work (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiPropertyOptional({ description: 'Optional notes about the volunteer work' })
  @IsOptional()
  @IsString()
  notes?: string;
}
