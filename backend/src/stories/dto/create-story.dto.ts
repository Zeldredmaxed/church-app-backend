import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStoryDto {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/photo.jpg' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: ['image', 'video'], example: 'image' })
  @IsOptional()
  @IsIn(['image', 'video'])
  mediaType?: 'image' | 'video';

  @ApiPropertyOptional({ example: 'God is good!' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional({ example: '#D4A574' })
  @IsOptional()
  @IsString()
  backgroundColor?: string;
}
