import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ChallengeTaskInput } from './challenge-task.dto';

/**
 * Bulk-replace the entire task set for a challenge — convenient for the
 * admin builder, which holds the whole plan in memory and saves at once.
 */
export class ReplaceTasksDto {
  @ApiProperty({ type: [ChallengeTaskInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChallengeTaskInput)
  tasks: ChallengeTaskInput[];
}
