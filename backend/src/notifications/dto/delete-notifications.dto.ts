import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteNotificationsDto {
  @ApiProperty({
    description: 'Notification IDs to delete. Only ids the caller owns are touched; others are silently skipped.',
    type: [String],
    minItems: 1,
    maxItems: 200,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}
