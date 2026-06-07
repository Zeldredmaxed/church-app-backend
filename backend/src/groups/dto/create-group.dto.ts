import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({ example: 'Youth Ministry' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'A group for youth ages 13-18.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  // ─── Migration 097 ───
  /**
   * Optional tag id linked to this group. When set, adding a member
   * to the group auto-assigns this tag; removing them auto-removes it.
   * Lets admins use group membership to drive tag-gated content access.
   */
  @ApiPropertyOptional({ description: 'Linked tag id — auto-assigned on group join, auto-removed on leave.' })
  @IsOptional()
  @IsUUID()
  autoTagId?: string;

  // ─── Migration 103 ───
  /** 0=Sun, 1=Mon, ..., 6=Sat. NULL = no fixed meeting day. */
  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  meetingDayOfWeek?: number;

  /** 'HH:MM' (24-hour). E.g. '19:00' for 7:00 PM. */
  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'meetingTimeStart must be HH:MM 24-hour' })
  meetingTimeStart?: string;

  @ApiPropertyOptional({ enum: ['weekly', 'biweekly', 'monthly'] })
  @IsOptional()
  @IsIn(['weekly', 'biweekly', 'monthly'])
  meetingFrequency?: 'weekly' | 'biweekly' | 'monthly';
}
