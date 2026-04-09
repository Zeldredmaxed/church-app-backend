import { IsString, IsNotEmpty, IsOptional, IsUUID, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  segmentId?: string;

  @ApiProperty({ enum: ['email', 'sms', 'push'] })
  @IsIn(['email', 'sms', 'push'])
  channel: string;

  @ApiPropertyOptional({ example: 'Sunday Service Update' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ example: 'Join us this Sunday for a special service...' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
