import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
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

  /** Migration 104: 'critical' added. */
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Migration 104: optional array of S3 URLs from the existing
   * /api/media presigned-upload flow. Mobile uploads each screenshot
   * to S3 first, then passes the resulting URLs here. Capped at 10
   * to keep the row small + the triage view fast.
   */
  @ApiPropertyOptional({ type: [String], description: 'S3 URLs from /api/media presigned upload. Max 10.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  screenshotUrls?: string[];

  /**
   * Migration 104: optional device/context info. Mobile sends e.g.:
   *   { platform: 'ios'|'android'|'web', osVersion, appVersion, route, buildNumber? }
   * Free-form JSONB on the server.
   */
  @ApiPropertyOptional({ description: 'Device/context info for bug reproduction.' })
  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, any>;
}
