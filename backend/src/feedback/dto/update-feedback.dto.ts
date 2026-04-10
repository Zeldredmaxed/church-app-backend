import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFeedbackDto {
  @ApiProperty({ enum: ['open', 'in_progress', 'completed', 'closed'] })
  @IsIn(['open', 'in_progress', 'completed', 'closed'])
  status: 'open' | 'in_progress' | 'completed' | 'closed';
}
