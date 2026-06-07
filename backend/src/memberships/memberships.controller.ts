import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  ParseUUIDPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MembershipsService } from './memberships.service';
import { MemberImportService } from './member-import.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { GetMembersDto } from './dto/get-members.dto';
import { ImportMembersDto } from './dto/import-members.dto';
import { SelfJoinDto, SwitchChurchDto } from './dto/self-join.dto';
import { assertUrlTenantMatchesJwt } from '../common/guards/tenant-clamp.helper';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TierGuard } from '../common/guards/tier.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresTier } from '../common/decorators/requires-tier.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { Response } from 'express';

@ApiTags('Memberships')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class MembershipsController {
  constructor(
    private readonly membershipsService: MembershipsService,
    private readonly memberImport: MemberImportService,
  ) {}

  @Get('memberships')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List all tenants the authenticated user belongs to' })
  @ApiResponse({ status: 200, description: 'Array of memberships with tenant details' })
  getMyMemberships(@CurrentUser() user: SupabaseJwtPayload) {
    return this.membershipsService.getMyMemberships(
      user.sub,
      user.app_metadata?.current_tenant_id ?? null,
    );
  }

  @Post('memberships/me/join')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Self-join a tenant (signup church picker or settings change church)',
    description:
      'Adds the authenticated user to the given tenant as a member. Idempotent — returns the existing membership if already joined. Auto-assigns the tenant\'s Guest tag (creating it if missing). Pair with POST /api/auth/switch-tenant + /auth/refresh to make this tenant the active context.',
  })
  @ApiResponse({ status: 201, description: '{ membership, tenant }' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  selfJoin(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SelfJoinDto,
  ) {
    return this.membershipsService.selfJoin(user.sub, dto.tenantId);
  }

  @Post('memberships/me/switch-church')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Atomic leave-current + join-new (settings → change church / change branch)',
    description:
      'Performs both operations in a single transaction so a failure can\'t strand the user with two memberships. Also updates last_accessed_tenant_id; client must call /api/auth/refresh afterwards to get the new JWT context.',
  })
  @ApiResponse({ status: 200, description: '{ membership, tenant, message }' })
  @ApiResponse({ status: 400, description: 'leaveTenantId equals joinTenantId' })
  @ApiResponse({ status: 404, description: 'Target tenant not found' })
  switchChurch(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: SwitchChurchDto,
  ) {
    return this.membershipsService.switchChurch(user, dto.leaveTenantId, dto.joinTenantId);
  }

  @Get('tenants/:tenantId/branches')
  @ApiOperation({
    summary: 'List sibling campuses for a tenant (Change Branch UI)',
    description:
      'Returns the parent organization + all of its campus tenants. Works whether the passed id is the parent or any of its children. Each row carries isParent so the UI can highlight the main church.',
  })
  @ApiResponse({ status: 200, description: 'Array of { id, name, brandColor, campusName, isParent, ... }' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  getBranches(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.membershipsService.getBranches(tenantId);
  }

  @Post('memberships')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a user to the current tenant (admin/pastor only)' })
  @ApiResponse({ status: 201, description: 'Membership created' })
  @ApiResponse({ status: 404, description: 'User with given email not found' })
  createMembership(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateMembershipDto,
  ) {
    return this.membershipsService.createMembership(dto, user);
  }

  @Get('tenants/:tenantId/members/kpis')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor', 'accountant')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get member KPI metrics for dashboard (admin/pastor/accountant only)' })
  @ApiResponse({ status: 200, description: 'Member KPIs: totalMembers, newThisMonth, activeLast30d' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  getMemberKpis(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.getMemberKpis(tenantId);
  }

  /**
   * Bulk member import from a CSV (migration 101). admin/pastor only,
   * throttled 3/hour to prevent both abuse and accidental double-uploads.
   *
   * Behavior (per the user spec):
   *   - PROFILE ONLY: auth.users row created with email_confirm=false +
   *     no password. Imported members CANNOT log in until invited.
   *   - NO emails sent at import time. Pastor controls timing via a
   *     workflow triggered on member_tagged for the assigned tag
   *     (default: "Imported - Pending Invite").
   *   - Idempotent on email — re-uploading the same CSV updates
   *     profile fields but doesn't double-create.
   *   - Each row is its own transaction; bad rows surface in the
   *     errors array but don't poison the whole import.
   */
  @Post('tenants/:tenantId/members/import-csv')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @Throttle({ default: { ttl: 3600000, limit: 3 } })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap, matches service-layer check
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import members from a Tithely/Breeze CSV file (admin/pastor only, 3/hour)' })
  @ApiResponse({ status: 200, description: '{ importId, totalRows, created, updated, skipped, errors }' })
  @ApiResponse({ status: 400, description: 'Invalid CSV, missing required fields, or > 5000 rows' })
  async importMembersCsv(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @UploadedFile() file: { originalname?: string; buffer: Buffer; size: number } | undefined,
    @Body() dto: ImportMembersDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    if (!file) {
      throw new BadRequestException('No file uploaded. Send the CSV as multipart `file` field.');
    }
    return this.memberImport.importCsv({
      tenantId,
      importedByUserId: user.sub,
      source: dto.source,
      filename: file.originalname ?? null,
      csvBuffer: file.buffer,
      assignTagName: dto.assignTag ?? 'Imported - Pending Invite',
    });
  }

  @Get('tenants/:tenantId/members/export')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @ApiOperation({ summary: 'Export tenant members as CSV (admin/pastor only, 5/hour)' })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  async exportMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Res() res: Response,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    const rows = await this.membershipsService.exportMembers(tenantId, user);
    const header = 'email,full_name,role,created_at';
    const csvRows = rows.map(
      (r) =>
        `"${(r.email ?? '').replace(/"/g, '""')}","${(r.full_name ?? '').replace(/"/g, '""')}","${r.role}","${r.created_at}"`,
    );
    const csv = [header, ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
    res.send(csv);
  }

  @Get('tenants/:tenantId/members')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor', 'accountant')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List tenant members with cursor-based pagination (admin/pastor/accountant only)' })
  @ApiResponse({ status: 200, description: 'Paginated member list with nextCursor' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  getMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: GetMembersDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.getMembers(tenantId, query.cursor, query.limit, query.missingTagIds);
  }

  @Get('tenants/:tenantId/members/:userId/profile-completeness')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({
    summary: "Get a member's per-requirement-set profile completeness (admin/pastor only)",
    description:
      'Admin variant of GET /api/users/me/profile-completeness — returns the same shape ({ sets: { core, volunteer, child_pickup, group_leader } }) for the target user. Admin must hold admin/pastor in the JWT current_tenant_id (matching :tenantId) AND the target user must be a member of that tenant.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ sets: { core: { complete, missing }, volunteer: { ... }, child_pickup: { ... }, group_leader: { ... } } }',
  })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  @ApiResponse({ status: 404, description: 'Member not found in this tenant' })
  getMemberProfileCompleteness(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.getMemberProfileCompleteness(tenantId, userId);
  }

  @Get('tenants/:tenantId/members/:userId/profile-extras')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({
    summary: "Get a member's full extended profile (admin/pastor only)",
    description: 'Returns every profile field including the ones excluded from public-profile responses (address, dateOfBirth, phone, emergencyContact, dietaryRestrictions, children). RLS + role guard restrict to tenant admins and pastors.',
  })
  @ApiResponse({ status: 200, description: 'Full member profile-extras shape' })
  @ApiResponse({ status: 404, description: 'Member not found in this tenant' })
  getProfileExtras(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.membershipsService.getProfileExtras(tenantId, userId, user);
  }

  @Patch('tenants/:tenantId/members/:userId/role')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Update a member role (admin/pastor only)' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  updateRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.updateRole(tenantId, userId, dto);
  }

  @Patch('tenants/:tenantId/members/:userId/permissions')
  @UseGuards(RoleGuard, TierGuard)
  @RequiresRole('admin', 'pastor')
  @RequiresTier('granularRoles')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Update member permissions (admin/pastor only, Pro+ tier)' })
  @ApiResponse({ status: 200, description: 'Permissions updated' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  updatePermissions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdatePermissionsDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.updatePermissions(tenantId, userId, dto);
  }

  @Delete('tenants/:tenantId/members/:userId')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from tenant (admin or self)' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  removeMember(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    // Self-removal is allowed across the user's own tenants; admin-driven
    // removal must match the JWT's tenant context to prevent cross-tenant
    // admin from removing arbitrary members elsewhere.
    if (userId !== user.sub) assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.removeMember(tenantId, userId);
  }

  @Post('tenants/:tenantId/members/import')
  @UseInterceptors(RlsContextInterceptor)
  @UseGuards(RoleGuard)
  @RequiresRole('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk import members from CSV data (admin only)' })
  @ApiResponse({ status: 200, description: '{ created, skipped, total, errors }' })
  @ApiResponse({ status: 403, description: 'Not authorized for this tenant' })
  importMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: { members: Array<{ email: string; fullName?: string; phone?: string; role?: string }> },
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    assertUrlTenantMatchesJwt(tenantId, user);
    return this.membershipsService.importMembers(tenantId, user.sub, body.members);
  }
}
