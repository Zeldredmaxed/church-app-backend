import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/**
 * One daily task in a challenge. The same shape is used inline when
 * authoring a challenge (CreateChallengeDto.tasks) and standalone via
 * the task CRUD endpoints.
 */
export class ChallengeTaskInput {
  @ApiProperty({ minimum: 1, description: '1-based day this task belongs to.' })
  @IsInt()
  @Min(1)
  @Max(366)
  dayIndex: number;

  @ApiPropertyOptional({ default: 0, description: 'Order within the day (0-based).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number = 0;

  @ApiProperty({ enum: ['scripture', 'reflection', 'checkin'] })
  @IsIn(['scripture', 'reflection', 'checkin'])
  taskType: 'scripture' | 'reflection' | 'checkin';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  title?: string;

  @ApiPropertyOptional({ description: 'e.g. "John 3:16-18" (scripture tasks).' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  scriptureReference?: string;

  @ApiPropertyOptional({ description: 'kjv | web | asv | ... (scripture tasks). Null → mobile default.' })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  scriptureTranslation?: string;

  @ApiPropertyOptional({ maxLength: 8000, description: 'Verse snapshot OR free instructions.' })
  @IsOptional()
  @IsString()
  @Length(0, 8000)
  body?: string;

  @ApiPropertyOptional({ description: 'Read-timer gate in seconds (scripture). Done stays disabled until it elapses.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  timerSeconds?: number;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Prompt above the free-text box (reflection tasks).' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  reflectionPrompt?: string;
}

export class UpdateChallengeTaskDto extends PartialType(ChallengeTaskInput) {}
