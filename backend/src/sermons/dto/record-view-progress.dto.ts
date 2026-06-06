import { IsInt, Min, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for POST /api/sermons/:id/progress. Mobile sends watch-progress
 * pings as the user scrubs through a sermon — every 15-30s while
 * playing is a reasonable cadence. The backend UPSERTs into
 * sermon_views with GREATEST() so a stale ping can't roll the
 * position backward.
 */
export class RecordViewProgressDto {
  @ApiProperty({
    description: 'Furthest position the user has watched, in seconds',
    example: 412,
  })
  @IsInt()
  @Min(0)
  lastWatchedSeconds: number;

  @ApiPropertyOptional({
    description:
      'Set true when the user reaches the end (or within a few seconds of it). Once set, completed_at sticks and the sermon disappears from continue-watching.',
  })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
