import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateTenantAddressDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  street?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  postalCode?: string;

  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'country must be a 2-letter ISO code' })
  country?: string;
}

/**
 * Body for PATCH /api/tenants/:id — partial church profile update.
 * admin/pastor only; tenant-clamped at the controller (caller can
 * only edit their own tenant).
 */
export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @ValidateNested()
  @Type(() => UpdateTenantAddressDto)
  @IsOptional()
  address?: UpdateTenantAddressDto;

  /** Hex color #RRGGBB used for brand accents in the apps. */
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be a 6-digit hex color (e.g. #1A2B3C)' })
  brandColor?: string;

  /** IANA timezone (e.g. "America/Chicago"). */
  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  /**
   * Monthly church-wide giving goal in cents (e.g. 500000 = $5,000).
   * Cap at $100M/mo — well above any realistic church goal and well
   * inside Number.MAX_SAFE_INTEGER so percentage-toward-goal math
   * doesn't lose precision.
   */
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(10_000_000_000)
  monthlyGivingGoalCents?: number;
}
