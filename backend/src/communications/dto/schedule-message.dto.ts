import { IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SendMessageDto } from './send-message.dto';

export class ScheduleMessageDto extends SendMessageDto {
  @ApiProperty({ example: '2026-04-15T10:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  scheduledFor: string;
}
