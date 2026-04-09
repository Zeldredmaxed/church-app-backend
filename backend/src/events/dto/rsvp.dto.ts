import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RsvpDto {
  @ApiProperty({ enum: ['going', 'interested', 'not_going'] })
  @IsIn(['going', 'interested', 'not_going'])
  status: 'going' | 'interested' | 'not_going';
}
