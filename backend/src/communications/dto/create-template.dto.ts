import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Welcome Email' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Welcome to our church!' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ example: 'Dear {{name}}, welcome to our community...' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiProperty({ enum: ['email', 'sms', 'push'] })
  @IsIn(['email', 'sms', 'push'])
  channel: string;
}
