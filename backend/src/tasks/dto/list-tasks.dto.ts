import { IsOptional, IsISO8601, IsBooleanString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Validation-only DTO for the new ?overdue / ?dueBefore params on
 * GET /api/tasks. The other (legacy) query params remain as bare
 * @Query() args on the controller to avoid churning their call sites.
 */
export class ListTasksDto {
  @ApiPropertyOptional({ description: 'When "true", returns tasks past their due date that are not completed' })
  @IsOptional()
  @IsBooleanString()
  overdue?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 timestamp — returns tasks with due_date strictly before this' })
  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  /**
   * Cursor for pagination — an ISO-8601 created_at timestamp from the
   * last row of the previous page. Validating it here turns garbage
   * cursors into a clean 400 instead of a 500 from the failed
   * `::timestamptz` cast in the service.
   */
  @ApiPropertyOptional({ description: 'ISO-8601 timestamp — pagination cursor (created_at of the last row seen)' })
  @IsOptional()
  @IsISO8601()
  cursor?: string;
}
