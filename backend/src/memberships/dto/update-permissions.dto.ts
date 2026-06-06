import { IsObject, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PERMISSION_KEY_SET, ALL_PERMISSION_KEYS } from '../../common/config/permissions.config';

/**
 * Validates that the permissions object contains ONLY keys from the
 * canonical catalog (common/config/permissions.config.ts) and that
 * every value is a boolean. Replaces the prior hardcoded 5-field DTO
 * (which had drifted from the catalog: manage_content / manage_worship
 * / view_analytics were accepted but not in the 27-key list).
 */
@ValidatorConstraint({ name: 'isPermissionsMap', async: false })
class IsPermissionsMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!PERMISSION_KEY_SET.has(k)) return false;
      if (typeof v !== 'boolean') return false;
    }
    return true;
  }
  defaultMessage(_args: ValidationArguments): string {
    return `permissions must be an object whose keys are drawn from the catalog (${ALL_PERMISSION_KEYS.join(', ')}) and whose values are booleans`;
  }
}

export class UpdatePermissionsDto {
  @ApiProperty({
    example: {
      manage_finance: true,
      manage_members: false,
      view_reports: true,
    },
    description:
      'Object of { permissionKey: boolean }. Keys must come from the catalog at GET /api/permissions/catalog. Unknown keys are rejected (was silently accepted in the pre-migration-100 version).',
  })
  @IsObject()
  @Validate(IsPermissionsMapConstraint)
  permissions: Record<string, boolean>;
}
