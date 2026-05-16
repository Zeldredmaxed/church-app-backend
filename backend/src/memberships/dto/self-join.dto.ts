import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Body for POST /api/memberships/me/join — user self-joins a tenant. */
export class SelfJoinDto {
  @ApiProperty({ description: 'Tenant the user wants to join' })
  @IsUUID()
  tenantId: string;
}

/**
 * Body for POST /api/memberships/me/switch-church — atomically leave the
 * caller's current tenant and join a new one. Used for "change church" and
 * "change branch" from the settings screen.
 */
export class SwitchChurchDto {
  @ApiProperty({ description: 'Tenant the user is leaving (usually their current_tenant_id)' })
  @IsUUID()
  leaveTenantId: string;

  @ApiProperty({ description: 'Tenant the user wants to join next' })
  @IsUUID()
  joinTenantId: string;
}
