import { IsString, IsNotEmpty, IsOptional, IsISO8601, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStreamDto {
  @ApiProperty({ example: 'Sunday Morning Worship — Aug 11' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: '2026-06-08T15:00:00Z' })
  @IsISO8601()
  startsAt: string;

  @ApiPropertyOptional({ example: '2026-06-08T16:30:00Z' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/thumb.jpg' })
  @IsOptional()
  @IsUrl()
  thumbnailUrl?: string;
}
