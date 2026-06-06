import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { UsersService } from './users.service';
import { ProfileCompletenessService, RequirementSet } from './profile-completeness.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly completeness: ProfileCompletenessService,
  ) {}

  @Get('admin/account-deletions')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @ApiOperation({
    summary: 'GDPR Art. 30: list account-deletion records for the current tenant (admin/pastor)',
    description:
      'Returns deletion log rows where tenant_ids[] contains the caller\'s current_tenant_id. ' +
      'Capped at 500 rows, newest first.',
  })
  @ApiResponse({
    status: 200,
    description: '{ data: [{ id, userId, email, fullName, tenantIds, deletedAt, ipAddress }] }',
  })
  getAccountDeletions(
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.usersService.listAccountDeletions(user.app_metadata?.current_tenant_id!);
  }

  @Get('me/profile-completeness')
  @ApiOperation({
    summary: 'Per-requirement-set profile completeness',
    description:
      'Returns one entry per requirement set (core, volunteer, child_pickup, group_leader) with { complete: boolean, missing: [{ field, label }] }. Mobile uses this to render checkmarks on the "Complete your profile" screen and to gate feature buttons.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ sets: { core: { complete, missing }, volunteer: { ... }, child_pickup: { ... }, group_leader: { ... } } }',
  })
  getProfileCompleteness(@CurrentUser() user: SupabaseJwtPayload) {
    return this.completeness.getAll(user.sub);
  }

  @Get('me')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  getMe(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update authenticated user profile (fullName, avatarUrl)' })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  updateMe(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Delete('me')
  @Throttle({ default: { ttl: 86400000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete account and all data (GDPR Right to Erasure, 3/day)' })
  @ApiResponse({ status: 200, description: 'Account deleted. All personal data erased.' })
  @ApiResponse({ status: 404, description: 'User not found' })
  deleteMe(@CurrentUser() user: SupabaseJwtPayload, @Req() req: Request) {
    const xff = req.headers['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : null) || req.ip || null;
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    return this.usersService.deleteMe(user.sub, { ip, userAgent });
  }

  @Get('me/settings')
  @ApiOperation({ summary: 'Get notification settings' })
  @ApiResponse({ status: 200, description: 'User notification settings' })
  getSettings(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getSettings(user.sub);
  }

  @Put('me/settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update notification settings' })
  @ApiResponse({ status: 200, description: 'Updated notification settings' })
  updateSettings(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(user.sub, dto);
  }

  @Get('me/streak')
  @ApiOperation({ summary: 'Get login streak info' })
  @ApiResponse({ status: 200, description: 'Current and longest login streak' })
  getStreak(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.getStreak(user.sub);
  }

  @Get('me/export')
  @Throttle({ default: { ttl: 86400000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export all personal data as JSON (GDPR Right of Access, 5/day)' })
  @ApiResponse({ status: 200, description: 'JSON dump of all user data across all tenants' })
  exportData(@CurrentUser() user: SupabaseJwtPayload) {
    return this.usersService.exportData(user.sub);
  }

  @Get(':userId/public-profile')
  @ApiOperation({
    summary: 'Public profile card for any user (safe fields only)',
    description:
      'Returns the user fields safe to display anywhere in the app: id, fullName, avatarUrl, and their home church (id/name/brandColor) for the ChurchPill. Excludes all PRIVATE profile fields (address, phone, dateOfBirth, emergencyContact, dietaryRestrictions, children).',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ id, fullName, avatarUrl, church: { id, name, brandColor } | null, createdAt }',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  getPublicProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.usersService.getPublicProfile(userId);
  }
}
