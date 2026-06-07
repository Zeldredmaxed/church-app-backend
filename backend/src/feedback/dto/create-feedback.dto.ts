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

/**
 * POST /api/feedback body.
 *
 * Field-name reconciliation (migrations 104 + 105): the mobile team's
 * shipped Feedback v2 contract uses `screenshots` + `contextMeta`;
 * my initial mig 104 used `screenshotUrls` + `deviceInfo`. Both names
 * are accepted here — the service normalizes to one canonical form
 * before insert. Old admin-side clients continue to work; the mobile
 * team's shipped client works without ABI change.
 *
 * Priority enum (mig 105): low | normal | high | critical.
 * Mobile auto-defaults priority by type:
 *   bug_report          → high
 *   feature_request     → normal
 *   node_request        → normal
 * User can override the default; the chosen value is what arrives here.
 * Default at the DB layer is 'normal' for any client that omits it.
 */
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

  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'critical'], default: 'normal' })
  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'critical'])
  priority?: 'low' | 'normal' | 'high' | 'critical';

  /**
   * Array of S3 URLs from the existing /api/media presigned-upload
   * flow. Mobile sends as `screenshots`; admin client may send as
   * `screenshotUrls`. Capped at 10 to bound the row size + triage
   * view size; mobile UI enforces 3.
   */
  @ApiPropertyOptional({ type: [String], description: 'S3 URLs (mobile field name). Max 10.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  screenshots?: string[];

  /** Legacy alias (migration 104 name) — accepted for back-compat. */
  @ApiPropertyOptional({ type: [String], description: 'Alias of screenshots. Max 10. Deprecated — prefer `screenshots`.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  screenshotUrls?: string[];

  /**
   * Device/context info for bug reproduction. Mobile sends:
   *   { appVersion, platform: 'ios'|'android', osVersion, fromScreen }
   * (`fromScreen` = React Navigation route name).
   * Free-form JSONB on the server — clients trusted to send sane strings.
   */
  @ApiPropertyOptional({ description: 'Mobile-shipped name. Stored as JSONB.' })
  @IsOptional()
  @IsObject()
  contextMeta?: Record<string, any>;

  /** Legacy alias (migration 104 name) — accepted for back-compat. */
  @ApiPropertyOptional({ description: 'Alias of contextMeta. Deprecated — prefer `contextMeta`.' })
  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, any>;
}
