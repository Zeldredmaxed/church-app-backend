import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSermonDto {
  @ApiProperty({ example: 'Walking in Faith' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Pastor John' })
  @IsString()
  @IsNotEmpty()
  speaker: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/audio/sermon1.mp3' })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/video/sermon1.mp4' })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/thumbs/sermon1.jpg' })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 2400, description: 'Duration in seconds' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ example: 'Faith Series' })
  @IsOptional()
  @IsString()
  seriesName?: string;

  @ApiPropertyOptional({ example: 'Key points from the sermon...' })
  @IsOptional()
  @IsString()
  notes?: string;
}
