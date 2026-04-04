import { SetMetadata } from '@nestjs/common';

/**
 * Decorator that specifies which permissions are required to access a route.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @Permissions('manage_finance')
 *   @Get('transactions')
 *   getTransactions() { ... }
 *
 * Multiple permissions can be specified (any one is sufficient):
 *   @Permissions('manage_finance', 'view_analytics')
 *
 * The PermissionsGuard checks the user's role and permissions from their
 * tenant_memberships record. Admins always pass all permission checks.
 */
export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
