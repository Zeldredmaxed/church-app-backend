import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PermissionFlags {
  [key: string]: boolean | undefined;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manage_finance?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manage_content?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manage_members?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manage_worship?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  view_analytics?: boolean;
}

export class UpdatePermissionsDto {
  @ApiProperty({
    example: {
      manage_finance: true,
      manage_content: false,
      manage_members: false,
      manage_worship: true,
      view_analytics: true,
    },
    description: 'Granular permission flags',
  })
  @ValidateNested()
  @Type(() => PermissionFlags)
  permissions: PermissionFlags;
}
