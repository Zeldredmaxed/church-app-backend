import { IsOptional, IsInt, IsArray, Min, Max, IsUUID } from 'class-validator';
import { Type, Transform } from 'class-transformer';
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

  /**
   * Comma-separated list of tag UUIDs. Returns only members who do NOT
   * have ANY of these tags. Useful for "find newcomers not yet welcomed"
   * (?missingTagIds=<Welcomed-tag-id>) or "members missing the Members
   * Class tag". Up to 20 ids; tags above that suggest the query is
   * better re-shaped.
   */
  @ApiPropertyOptional({
    description: 'Comma-separated tag UUIDs — return members missing ALL of these tags',
    example: 'a1b2c3d4-...,e5f6g7h8-...',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map(s => s.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @IsUUID('4', { each: true })
  missingTagIds?: string[];
}
