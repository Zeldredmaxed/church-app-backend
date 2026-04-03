import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['admin', 'pastor', 'member'], example: 'pastor' })
  @IsIn(['admin', 'pastor', 'member'], {
    message: "role must be one of: 'admin', 'pastor', 'member'",
  })
  role: 'admin' | 'pastor' | 'member';
}
