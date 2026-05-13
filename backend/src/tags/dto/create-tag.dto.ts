import { IsString, IsNotEmpty, MaxLength, Matches, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const GRANTABLE_ROLES = ['admin', 'pastor', 'moderator'] as const;
export type GrantableRole = typeof GRANTABLE_ROLES[number];

export class CreateTagDto {
  @ApiProperty({ example: 'Praise Team' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: '#6366f1' })
  @IsString()
  @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'color must be a valid hex color (e.g. #ff0000 or #f00)',
  })
  color: string;

  @ApiPropertyOptional({
    enum: GRANTABLE_ROLES,
    description: 'When set, assigning this tag also grants the user this role in the tenant. Removing the tag (if no other tag grants the same role) drops them back to member. Only tenant admins/pastors can set this — enforced at the RLS layer.',
  })
  @IsOptional()
  @IsIn(GRANTABLE_ROLES, {
    message: `grantsRole must be one of: ${GRANTABLE_ROLES.join(', ')}`,
  })
  grantsRole?: GrantableRole;
}
