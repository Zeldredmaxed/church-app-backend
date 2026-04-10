import { IsUUID, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ALL_RELATIONSHIPS } from '../family-types';

export class SendFamilyRequestDto {
  @ApiProperty({ description: 'The user you want to add as family' })
  @IsUUID()
  targetUserId: string;

  @ApiProperty({
    description: 'Relationship category',
    example: 'spouse',
    enum: ALL_RELATIONSHIPS,
  })
  @IsString()
  @IsIn(ALL_RELATIONSHIPS, { message: 'Invalid relationship type' })
  relationship: string;
}
