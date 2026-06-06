import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({ description: 'First user message — used to start the conversation and auto-title it.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content: string;

  @ApiPropertyOptional({ description: 'Optional explicit title; if omitted we infer one from the first message.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
