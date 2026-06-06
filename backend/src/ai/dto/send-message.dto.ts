import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'User message content. Reply streams back via SSE.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content: string;
}
