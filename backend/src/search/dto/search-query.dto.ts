import { IsString, MinLength, MaxLength, IsOptional, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Search query parameters with cursor-based pagination.
 * Uses `websearch_to_tsquery` which supports natural search syntax:
 *   - "church picnic" → phrase match
 *   - church OR picnic → OR search
 *   - church -picnic → exclusion
 */
export class SearchQueryDto {
  @ApiProperty({ example: 'sunday sermon', minLength: 1, maxLength: 200, description: 'Full-text search query (supports phrases, OR, exclusion)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Cursor for pagination' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
