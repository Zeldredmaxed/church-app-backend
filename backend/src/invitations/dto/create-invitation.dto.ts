import { IsEmail, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Payload for POST /api/invitations.
 *
 * tenantId is excluded — it is derived from the admin's current JWT context.
 * An admin can only send invitations for the tenant they are currently acting within.
 */
export class CreateInvitationDto {
  @ApiProperty({ example: 'invitee@example.com', description: 'Email address of the person being invited' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['admin', 'pastor', 'member'], example: 'member' })
  @IsIn(['admin', 'pastor', 'member'], {
    message: "role must be one of: 'admin', 'pastor', 'member'",
  })
  role: 'admin' | 'pastor' | 'member';
}
