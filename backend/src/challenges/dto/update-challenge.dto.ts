import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateChallengeDto } from './create-challenge.dto';

/**
 * Update a challenge's metadata + publish state. Task edits go through
 * the dedicated task endpoints (or PUT .../tasks to replace the set),
 * so `tasks` is omitted here.
 */
export class UpdateChallengeDto extends PartialType(
  OmitType(CreateChallengeDto, ['tasks'] as const),
) {}
