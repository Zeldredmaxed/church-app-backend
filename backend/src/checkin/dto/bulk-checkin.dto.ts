import { IsArray, IsUUID, IsOptional, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkCheckinDto {
  @ApiProperty({ description: 'Array of user UUIDs to check in', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiPropertyOptional({
    description: 'Optional service UUID (recurring service slot from /api/services)',
  })
  @IsOptional()
  @IsUUID('4')
  serviceId?: string;

  @ApiPropertyOptional({
    description:
      'Optional event UUID (one-off event from /api/events). Either eventId or serviceId may be provided — both is fine but unusual.',
  })
  @IsOptional()
  @IsUUID('4')
  eventId?: string;
}
