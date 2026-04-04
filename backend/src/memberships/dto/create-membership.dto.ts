import { IsEmail, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Payload for POST /api/memberships.
 *
 * The tenant_id is NOT included here — it is derived from the requesting admin's
 * current JWT context (current_tenant_id). Admins can only add members to the
 * tenant they are currently acting within, enforced by the RLS INSERT policy.
 */
export class CreateMembershipDto {
  @ApiProperty({ example: 'newmember@example.com', description: 'Email of the user to add. Must already have a platform account.' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['admin', 'pastor', 'accountant', 'worship_leader', 'member'], example: 'member' })
  @IsIn(['admin', 'pastor', 'accountant', 'worship_leader', 'member'], {
    message: "role must be one of: 'admin', 'pastor', 'accountant', 'worship_leader', 'member'",
  })
  role: 'admin' | 'pastor' | 'accountant' | 'worship_leader' | 'member';
}
