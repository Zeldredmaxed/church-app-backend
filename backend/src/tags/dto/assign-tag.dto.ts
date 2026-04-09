import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTagDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'], description: 'Array of user UUIDs to assign the tag to' })
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];
}
