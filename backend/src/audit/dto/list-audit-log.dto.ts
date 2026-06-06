import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAuditLogDto {
  @ApiPropertyOptional({ description: 'Filter by actor user id' })
  @IsOptional()
  @IsUUID()
  actor?: string;

  @ApiPropertyOptional({
    description: 'Filter by actor role at time of action, e.g. admin / pastor / accountant',
  })
  @IsOptional()
  @IsIn(['admin', 'pastor', 'accountant', 'volunteer_leader', 'member', 'unknown'])
  actorRole?: string;

  @ApiPropertyOptional({
    description:
      "Case-insensitive substring match on the summary text. Useful for finding 'donations from Jane' or 'removed by pastor X'.",
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summarySearch?: string;

  @ApiPropertyOptional({ description: 'Filter by target user id' })
  @IsOptional()
  @IsUUID()
  target?: string;

  @ApiPropertyOptional({ description: "Exact match on action key, e.g. 'member.blocked'" })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: "Prefix match, e.g. 'finance.' returns all finance events" })
  @IsOptional()
  @IsString()
  actionPrefix?: string;

  @ApiPropertyOptional({ description: "Filter to resourceType, e.g. 'tag', 'user'" })
  @IsOptional()
  @IsIn(['user', 'post', 'tag', 'group', 'event', 'sermon', 'fund', 'church', 'notification', 'comment', 'family'])
  resourceType?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — entries on or after this' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp — entries strictly before this' })
  @IsOptional()
  @IsDateString()
  until?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor — pass the previous response.nextCursor to fetch the next page',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
