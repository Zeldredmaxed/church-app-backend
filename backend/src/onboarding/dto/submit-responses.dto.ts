import { IsObject, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitResponsesDto {
  @ApiProperty({ description: 'The user ID (from just-created account)' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Form responses keyed by field key', example: { is_baptized: true, interests: ['Worship/Music'] } })
  @IsObject()
  responses: Record<string, any>;
}
