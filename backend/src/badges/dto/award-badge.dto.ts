import { IsArray, IsUUID, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AwardBadgeDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'], description: 'Array of user UUIDs to award the badge to' })
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiPropertyOptional({ example: 'Faithful attendance for 6 months' })
  @IsOptional()
  @IsString()
  reason?: string;
}
