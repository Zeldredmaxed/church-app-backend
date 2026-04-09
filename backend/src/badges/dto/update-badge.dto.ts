import { IsString, IsNotEmpty, MaxLength, IsOptional, Matches, IsIn, IsInt, IsObject, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBadgeDto {
  @ApiPropertyOptional({ example: 'Generous Giver' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Awarded to members who have given over $1,000' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'award' })
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

  @ApiPropertyOptional({ example: { type: 'giving_lifetime', threshold: 1000 } })
  @IsOptional()
  @IsObject()
  autoAwardRule?: Record<string, any>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
