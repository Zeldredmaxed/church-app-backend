import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for PATCH /api/tenants/:id/branding (migration 109).
 *
 * All fields optional — send only what's changing. Explicit `null`
 * clears a field (resets to default). Validation runs at the DTO
 * layer rather than via DB CHECK constraints so the mobile client
 * gets structured error-code messages instead of bare 500s.
 *
 * Error codes are prefixed onto the message strings so the mobile
 * client can detect them with `message.includes('INVALID_HEX')`:
 *   INVALID_HEX             — color isn't #RRGGBB
 *   INVALID_DISPLAY_NAME    — display name length wrong
 *   INVALID_WELCOME         — welcome > 200 chars
 *   INVALID_LOGO_URL        — service-layer (host check)
 *   BRANDING_REQUIRES_ENTERPRISE — service-layer (tier gate)
 */
const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX_MSG = 'INVALID_HEX: must be #RRGGBB';

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: '#0F766E', description: '#RRGGBB or null to reset' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(HEX, { message: `brandPrimary: ${HEX_MSG}` })
  brandPrimary?: string | null;

  @ApiPropertyOptional({ example: '#F59E0B', description: '#RRGGBB or null to reset' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(HEX, { message: `brandSecondary: ${HEX_MSG}` })
  brandSecondary?: string | null;

  @ApiPropertyOptional({ example: '#0F766E', description: '#RRGGBB or null to fall back to brandPrimary' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(HEX, { message: `brandPillColor: ${HEX_MSG}` })
  brandPillColor?: string | null;

  @ApiPropertyOptional({ minLength: 2, maxLength: 80, example: 'New Eden' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MinLength(2, { message: 'INVALID_DISPLAY_NAME: brandDisplayName must be 2-80 chars' })
  @MaxLength(80, { message: 'INVALID_DISPLAY_NAME: brandDisplayName must be 2-80 chars' })
  brandDisplayName?: string | null;

  /**
   * S3/CDN URL for the logo. Format-validated as URL in DTO; the
   * service layer enforces that the host is in our allowlist
   * (returns INVALID_LOGO_URL on mismatch — prevents the branding
   * field from being used as a link-spam vector).
   */
  @ApiPropertyOptional({ description: 'Public S3 URL or null to reset' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  brandLogoUrl?: string | null;

  @ApiPropertyOptional({ maxLength: 200, example: 'Welcome to New Eden — join us this Sunday.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: 'INVALID_WELCOME: brandWelcomeMessage must be ≤200 chars' })
  brandWelcomeMessage?: string | null;
}
