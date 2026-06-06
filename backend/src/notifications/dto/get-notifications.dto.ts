import { IsOptional, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NOTIFICATION_TYPE_KEYS } from '../notifications.types';

export class GetNotificationsDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'When true, returns only unread notifications', default: false })
  @IsOptional()
  @Type(() => Boolean)
  unreadOnly?: boolean;

  @ApiPropertyOptional({ description: 'Filter to a single notification type', enum: NOTIFICATION_TYPE_KEYS as readonly string[] })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_KEYS as readonly string[])
  type?: string;
}
