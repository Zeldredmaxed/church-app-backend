import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JoinIosWaitlistDto {
  @ApiProperty({ example: 'pastor@church.org' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;

  /** Where the request came from — drives A/B testing on different QR posters. */
  @ApiPropertyOptional({ example: 'sunday_qr_poster' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  /** Free-form device context. Mobile sends { osVersion, userAgent, ... }. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, any>;
}
