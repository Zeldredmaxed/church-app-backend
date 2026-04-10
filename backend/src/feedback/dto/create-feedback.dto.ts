import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty({ enum: ['node_request', 'bug_report', 'feature_request'] })
  @IsIn(['node_request', 'bug_report', 'feature_request'])
  type: 'node_request' | 'bug_report' | 'feature_request';

  @ApiProperty({ example: '[ACTION] Send WhatsApp Message', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Description of the request...' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'], default: 'medium' })
  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: 'low' | 'medium' | 'high';
}
