import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInChildDto {
  @ApiPropertyOptional({ description: 'Child user UUID (if registered)' })
  @IsOptional()
  @IsUUID('4')
  childId?: string;

  @ApiPropertyOptional({ description: 'Child name (for visitors without account)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  childName?: string;

  @ApiProperty({ description: 'Guardian user UUID' })
  @IsUUID('4')
  guardianId!: string;

  @ApiPropertyOptional({ description: 'Service UUID' })
  @IsOptional()
  @IsUUID('4')
  serviceId?: string;
}
