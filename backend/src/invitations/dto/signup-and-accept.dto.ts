import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /api/invitations/:token/signup-and-accept (PUBLIC).
 *
 * Used when the invitee doesn't yet have a Shepard account — the
 * invitation accept flow creates the auth user + sets a password +
 * accepts the membership in one server call. Email comes from the
 * invitation row (not the body — invitations are bound to a specific
 * email, and we can't let an invitee redirect it to a different one).
 */
export class SignupAndAcceptInvitationDto {
  /** Password for the new account. Validated against Supabase's default min-length 6, but we require 8 to match our /auth/signup posture. */
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must not exceed 72 characters (bcrypt cap)' })
  password!: string;

  /** Display name. Optional — defaults to the email's local-part. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
