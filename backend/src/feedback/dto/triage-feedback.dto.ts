import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for POST /api/feedback/:id/triage (migration 104, super-admin
 * only). All fields optional — triage can be partial (just bump
 * priority, just set category, etc.). At least one MUST be present
 * or the server returns 400.
 *
 * Calling this endpoint stamps triaged_at = now() and triaged_by =
 * caller.sub regardless of which fields are updated. To leave a row
 * "untriaged" again, hit it again with `untriage: true` (separate
 * mechanism — not in this DTO).
 */
export class TriageFeedbackDto {
  @ApiPropertyOptional({ enum: ['frontend', 'backend', 'admin', 'unknown'] })
  @IsOptional()
  @IsIn(['frontend', 'backend', 'admin', 'unknown'])
  category?: 'frontend' | 'backend' | 'admin' | 'unknown';

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical';

  @ApiPropertyOptional({ enum: ['open', 'in_progress', 'completed', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'in_progress', 'completed', 'closed'])
  status?: 'open' | 'in_progress' | 'completed' | 'closed';

  /** Free-text notes from the triager (repro steps, suspected cause, etc.). */
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  triageNotes?: string;
}
