import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSermonDto {
  @ApiPropertyOptional({ example: 'Walking in Faith' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Pastor John' })
  @IsOptional()
  @IsString()
  speaker?: string;

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

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: 'Full transcript text...' })
  @IsOptional()
  @IsString()
  transcript?: string;
}
