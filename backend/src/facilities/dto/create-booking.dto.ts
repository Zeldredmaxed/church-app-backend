import { IsString, IsNotEmpty, IsOptional, IsUUID, IsISO8601 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  @IsNotEmpty()
  roomId: string;

  @ApiProperty({ example: 'Youth Group Meeting' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: '2026-04-10T09:00:00Z' })
  @IsISO8601()
  @IsNotEmpty()
  startAt: string;

  @ApiProperty({ example: '2026-04-10T11:00:00Z' })
  @IsISO8601()
  @IsNotEmpty()
  endAt: string;

  @ApiPropertyOptional({ example: 'Need projector setup' })
  @IsOptional()
  @IsString()
  notes?: string;
}
