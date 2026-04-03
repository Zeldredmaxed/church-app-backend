import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({ format: 'uuid', description: 'User ID to add to the channel' })
  @IsUUID('4')
  userId: string;
}
