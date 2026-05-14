import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Allowed fields for PATCH /api/users/me.
 *
 * Every field is optional. The server never requires anything — the
 * mobile section editor saves the whole sheet, including fields the
 * user left blank, and the backend writes through whatever was set.
 *
 * Validation is type-only ("is this a date string?", "is this a
 * boolean?") — no length minimums, no "required" rules. Reject only
 * malformed values.
 *
 * Intentionally excludes:
 *   - email          → managed by Supabase Auth (requires re-verification)
 *   - id             → immutable
 *   - last_accessed_tenant_id → managed by POST /api/auth/switch-tenant only
 */
export const GENDER_VALUES = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const;
export type Gender = typeof GENDER_VALUES[number];

export const CONTACT_METHODS = ['email', 'phone', 'sms', 'mail'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'engaged', 'separated', 'divorced', 'widowed'] as const;
export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] as const;

export class UpdateUserDto {
  // ─── Identity / appearance ───
  @ApiPropertyOptional({ example: 'John Doe', maxLength: 255 })
  @IsOptional() @IsString() @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg', maxLength: 2048 })
  @IsOptional() @IsUrl({}, { message: 'avatarUrl must be a valid URL' }) @MaxLength(2048)
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: GENDER_VALUES })
  @IsOptional() @IsIn(GENDER_VALUES, { message: `gender must be one of: ${GENDER_VALUES.join(', ')}` })
  gender?: Gender;

  // ─── Contact ───
  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional() @IsString() @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '+15559876543' })
  @IsOptional() @IsString() @MaxLength(50)
  phoneSecondary?: string;

  @ApiPropertyOptional({ description: 'JSONB: { street, street2?, city, state, postalCode, country }' })
  @IsOptional() @IsObject()
  address?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: CONTACT_METHODS })
  @IsOptional() @IsIn(CONTACT_METHODS, { message: `preferredContactMethod must be one of: ${CONTACT_METHODS.join(', ')}` })
  preferredContactMethod?: typeof CONTACT_METHODS[number];

  // ─── Personal ───
  @ApiPropertyOptional({ example: '1990-04-15', description: 'ISO 8601 date (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({}, { message: 'dateOfBirth must be a valid ISO date' })
  dateOfBirth?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  occupation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  employer?: string;

  @ApiPropertyOptional({ enum: MARITAL_STATUSES })
  @IsOptional() @IsIn(MARITAL_STATUSES, { message: `maritalStatus must be one of: ${MARITAL_STATUSES.join(', ')}` })
  maritalStatus?: typeof MARITAL_STATUSES[number];

  @ApiPropertyOptional({ example: '2015-06-12', description: 'ISO 8601 date (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({}, { message: 'anniversary must be a valid ISO date' })
  anniversary?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  spouseName?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  hasChildren?: boolean;

  @ApiPropertyOptional({ description: 'JSONB array: [{ name, dateOfBirth?, notes? }, ...]' })
  @IsOptional() @IsArray()
  children?: Array<Record<string, unknown>>;

  @ApiPropertyOptional({ description: 'JSONB: { name, relationship, phone, email? }' })
  @IsOptional() @IsObject()
  emergencyContact?: Record<string, unknown>;

  // ─── Church / spiritual ───
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  membershipStatus?: string;

  @ApiPropertyOptional({ example: '2018-09-01', description: 'ISO 8601 date (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({}, { message: 'memberSince must be a valid ISO date' })
  memberSince?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  baptized?: boolean;

  @ApiPropertyOptional({ example: '2019-04-21', description: 'ISO 8601 date (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({}, { message: 'baptismDate must be a valid ISO date' })
  baptismDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  baptismLocation?: string;

  @ApiPropertyOptional({ example: '2017-12-25', description: 'ISO 8601 date (YYYY-MM-DD)' })
  @IsOptional() @IsDateString({}, { message: 'salvationDate must be a valid ISO date' })
  salvationDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  previousChurch?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  howDidYouHear?: string;

  // ─── Engagement ───
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  serviceInterests?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: TSHIRT_SIZES })
  @IsOptional() @IsIn(TSHIRT_SIZES, { message: `tshirtSize must be one of: ${TSHIRT_SIZES.join(', ')}` })
  tshirtSize?: typeof TSHIRT_SIZES[number];

  @ApiPropertyOptional({ type: [String], description: 'PRIVATE — never exposed in public profiles' })
  @IsOptional() @IsArray() @IsString({ each: true })
  dietaryRestrictions?: string[];

  // ─── Communication consent ───
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  newsletterOptIn?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  smsOptIn?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  photoReleaseConsent?: boolean;

  // ─── Public-profile visibility flags ───
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  birthdayVisible?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  anniversaryVisible?: boolean;
}
