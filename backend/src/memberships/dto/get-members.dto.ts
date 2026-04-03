import { IsOptional, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cursor-based pagination for tenant member listing.
 * `cursor` is the user_id of the last member seen — returns members after it
 * in alphabetical order by full_name.
 */
export class GetMembersDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'user_id of last member seen' })
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
