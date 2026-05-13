import { IsString, IsOptional, IsNotEmpty, MaxLength, Matches, IsIn, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GRANTABLE_ROLES, GrantableRole } from './create-tag.dto';

export class UpdateTagDto {
  @ApiPropertyOptional({ example: 'Youth Group' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: '#ef4444' })
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'color must be a valid hex color (e.g. #ff0000 or #f00)',
  })
  color?: string;

  @ApiPropertyOptional({
    enum: [...GRANTABLE_ROLES, null],
    description: 'Pass a role string to make this tag grant that role on assignment. Pass null explicitly to clear the grant (existing assignees keep their current tenant_memberships role — clearing the tag config does NOT retroactively demote).',
    nullable: true,
  })
  @IsOptional()
  // Allow explicit null to clear the grant. @IsIn rejects null, so guard.
  @ValidateIf((_, v) => v !== null)
  @IsIn(GRANTABLE_ROLES, {
    message: `grantsRole must be null or one of: ${GRANTABLE_ROLES.join(', ')}`,
  })
  grantsRole?: GrantableRole | null;
}
