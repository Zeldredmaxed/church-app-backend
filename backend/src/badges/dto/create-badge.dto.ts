import { IsString, IsNotEmpty, MaxLength, IsOptional, Matches, IsIn, IsInt, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBadgeDto {
  @ApiProperty({ example: 'Generous Giver' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Awarded to members who have given over $1,000' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'hand-prayer', description: 'Hugeicons icon name (kebab-case). See GET /badges/icons for available icons.' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'color must be a valid hex color (e.g. #ff0000 or #f00)',
  })
  color?: string;

  @ApiPropertyOptional({ example: 'gold', enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'] })
  @IsOptional()
  @IsIn(['bronze', 'silver', 'gold', 'platinum', 'diamond'])
  tier?: string;

  @ApiPropertyOptional({ example: 'giving', enum: ['giving', 'attendance', 'spiritual', 'service', 'engagement', 'custom'] })
  @IsOptional()
  @IsIn(['giving', 'attendance', 'spiritual', 'service', 'engagement', 'custom'])
  category?: string;

  @ApiPropertyOptional({ example: { type: 'giving_lifetime', threshold: 1000 }, description: 'JSON rule for auto-awarding' })
  @IsOptional()
  @IsObject()
  autoAwardRule?: Record<string, any>;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
