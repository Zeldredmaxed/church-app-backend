import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelEventDto {
  @ApiPropertyOptional({
    description: 'Optional reason shown to RSVPed attendees in the cancellation notification.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
