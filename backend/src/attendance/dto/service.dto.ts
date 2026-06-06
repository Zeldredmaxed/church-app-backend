import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** HH:MM 24-hour format (e.g. "09:00", "17:30"). */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateServiceDto {
  @ApiProperty({ example: 'Sunday 9am Worship', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sunday, 6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00', description: 'HH:MM 24-hour local time' })
  @IsString()
  @Matches(HHMM_RE, { message: 'startTime must be HH:MM (24-hour)' })
  startTime: string;

  @ApiProperty({ example: '10:30', description: 'HH:MM 24-hour local time' })
  @IsString()
  @Matches(HHMM_RE, { message: 'endTime must be HH:MM (24-hour)' })
  endTime: string;

  @ApiProperty({ example: 33.7490 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -84.3880 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ default: 800, minimum: 50, maximum: 5000, description: 'Geofence radius in meters (default 800 ≈ half mile)' })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  radiusMeters?: number;

  @ApiPropertyOptional({ default: 15, minimum: 0, maximum: 120, description: 'Minutes past start a first ping is flagged "late"' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  lateThresholdMinutes?: number;

  @ApiPropertyOptional({ default: 15, minimum: 0, maximum: 120, description: 'Minutes before end a last ping is flagged "left early"' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  earlyLeaveThresholdMinutes?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: true, description: 'When false, no auto-push fires at start. Manual pings still get processed.' })
  @IsOptional()
  @IsBoolean()
  autoPushEnabled?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pushMessage?: string;
}

export class UpdateServiceDto extends CreateServiceDto {
  // All fields optional on update — class-validator's @IsOptional()
  // on the base already covers the optional ones; required ones become
  // optional via the override below.
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @IsOptional() @IsString() @Matches(HHMM_RE) startTime: string;
  @IsOptional() @IsString() @Matches(HHMM_RE) endTime: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude: number;
}

export class SetOptInDto {
  @ApiProperty()
  @IsBoolean()
  optedIn: boolean;
}

export class PingDto {
  @ApiProperty({ example: 33.7490 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: -84.3880 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({ description: 'GPS accuracy radius in meters; reported by the OS', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  @ApiPropertyOptional({
    enum: ['background', 'geofence_entry', 'geofence_exit', 'foreground', 'auto_push_reply'],
    default: 'background',
    description:
      'How this ping was triggered. Used for analytics + debugging "I was there but the OS killed the app" complaints.',
  })
  @IsOptional()
  @IsString()
  source?: 'background' | 'geofence_entry' | 'geofence_exit' | 'foreground' | 'auto_push_reply';
}

export class CancelOccurrenceDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
