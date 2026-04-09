import { IsArray, IsUUID, IsOptional, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkCheckinDto {
  @ApiProperty({ description: 'Array of user UUIDs to check in', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiPropertyOptional({ description: 'Optional service UUID' })
  @IsOptional()
  @IsUUID('4')
  serviceId?: string;
}
