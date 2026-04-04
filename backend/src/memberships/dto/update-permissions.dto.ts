import { IsObject, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
  @IsObject()
  permissions: {
    manage_finance?: boolean;
    manage_content?: boolean;
    manage_members?: boolean;
    manage_worship?: boolean;
    view_analytics?: boolean;
  };
}
