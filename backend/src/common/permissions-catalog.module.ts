import { Module } from '@nestjs/common';
import { PermissionsCatalogController } from './permissions-catalog.controller';

/**
 * Tiny module that owns the public /api/permissions/catalog endpoint.
 * No providers, no dependencies — the controller just returns
 * static metadata from common/config/permissions.config.ts.
 */
@Module({
  controllers: [PermissionsCatalogController],
})
export class PermissionsCatalogModule {}
