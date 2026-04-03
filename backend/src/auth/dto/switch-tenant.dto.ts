import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SwitchTenantDto {
  @ApiProperty({ format: 'uuid', description: 'Target tenant to switch context to' })
  @IsUUID(4, { message: 'tenantId must be a valid UUID' })
  tenantId: string;
}
