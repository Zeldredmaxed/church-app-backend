import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HeartbeatDto {
  @ApiProperty({
    description: 'Seconds elapsed since the previous heartbeat. Clamped to [0, 90] server-side.',
    example: 60,
    minimum: 0,
    maximum: 600,
  })
  @IsInt()
  @Min(0)
  @Max(600)
  deltaSeconds: number;

  @ApiPropertyOptional({
    description: 'True on the first heartbeat after the app foregrounded (or the first heartbeat ever). Increments session_count.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isNewSession?: boolean;
}
