import { IsOptional, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cursor-based pagination for chat messages.
 * `cursor` is the UUID of the last message seen — returns messages BEFORE it.
 * If no cursor, returns the most recent messages.
 */
export class GetMessagesDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'UUID of last message seen — loads older messages' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
