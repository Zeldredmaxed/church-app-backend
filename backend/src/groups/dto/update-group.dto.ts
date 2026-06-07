import {
  IsString,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  Matches,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Young Adults' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'A group for young adults ages 18-30.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  // ─── Migration 097: explicit null permitted to UNLINK an existing tag.
  @ApiPropertyOptional({ description: 'Linked tag id (auto-assign on add). Set null to unlink.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  autoTagId?: string | null;

  // ─── Migration 103
  @ApiPropertyOptional({ minimum: 0, maximum: 6, description: '0=Sun..6=Sat. null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(6)
  meetingDayOfWeek?: number | null;

  @ApiPropertyOptional({ example: '19:00', description: 'HH:MM 24-hour. null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'meetingTimeStart must be HH:MM 24-hour' })
  meetingTimeStart?: string | null;

  @ApiPropertyOptional({ enum: ['weekly', 'biweekly', 'monthly'] })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(['weekly', 'biweekly', 'monthly'])
  meetingFrequency?: 'weekly' | 'biweekly' | 'monthly' | null;
}
