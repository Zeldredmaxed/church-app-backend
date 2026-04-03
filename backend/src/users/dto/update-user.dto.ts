import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Allowed fields for PATCH /api/users/me.
 *
 * Intentionally excludes:
 *   - email          → managed by Supabase Auth (requires re-verification)
 *   - id             → immutable
 *   - last_accessed_tenant_id → managed by POST /api/auth/switch-tenant only
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John Doe', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg', maxLength: 2048 })
  @IsOptional()
  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  @MaxLength(2048)
  avatarUrl?: string;
}
