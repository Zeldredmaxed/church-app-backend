import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_LABELS,
} from './config/permissions.config';

/**
 * Public catalog of permission keys + labels (migration 100). Admin
 * dashboard uses this to render the per-member permission matrix
 * without hardcoding the key list — when we add a new key, the UI
 * picks it up automatically.
 *
 * No auth required: the catalog is structural metadata, not secrets.
 * Throttle skipped — it's a static read mobile / admin may call on
 * startup. Response is small enough to cache aggressively client-side.
 */
@ApiTags('Permissions')
@Controller('permissions')
@SkipThrottle()
export class PermissionsCatalogController {
  @Get('catalog')
  @ApiOperation({
    summary: 'List all permission keys + labels',
    description:
      'Static catalog of the 27 permission keys the backend recognizes ' +
      'for tenant_memberships.permissions JSONB. Admin/pastor roles ' +
      'bypass these checks; all other roles are gated by their explicit ' +
      'set. Mobile/admin use this to render the permission matrix.',
  })
  @ApiResponse({ status: 200, description: '{ permissions: Array<{ key, label }> }' })
  getCatalog(): { permissions: Array<{ key: string; label: string }> } {
    return {
      permissions: ALL_PERMISSION_KEYS.map((key) => ({
        key,
        label: PERMISSION_LABELS[key],
      })),
    };
  }
}
