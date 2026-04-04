import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['admin', 'pastor', 'accountant', 'worship_leader', 'member'], example: 'pastor' })
  @IsIn(['admin', 'pastor', 'accountant', 'worship_leader', 'member'], {
    message: "role must be one of: 'admin', 'pastor', 'accountant', 'worship_leader', 'member'",
  })
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';
}
