import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsString, IsUUID, MaxLength } from 'class-validator';
import { FamilyService } from './family.service';
import { SendFamilyRequestDto } from './dto/send-family-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

class RespondToRequestDto {
  @IsBoolean()
  accept: boolean;
}

class SetVisibilityDto {
  @IsBoolean()
  isPublic: boolean;
}

@ApiTags('Family')
@ApiBearerAuth()
@Controller('family')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  // ── Static routes MUST come before :userId param routes ──

  @Get('types')
  @ApiOperation({ summary: 'Get all relationship types grouped by category' })
  getTypes() {
    return this.familyService.getTypes();
  }

  @Post('request')
  @ApiOperation({ summary: 'Send a family connection request' })
  @ApiResponse({ status: 201, description: 'Request sent, notification dispatched' })
  sendRequest(
    @Body() dto: SendFamilyRequestDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.sendRequest(tenantId, user.sub, dto.targetUserId, dto.relationship);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get all pending family requests (sent and received)' })
  getRequests(@CurrentUser() user: SupabaseJwtPayload) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getRequests(tenantId, user.sub);
  }

  @Post('requests/:id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept or reject a family request' })
  respondToRequest(
    @Param('id', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondToRequestDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.respondToRequest(tenantId, user.sub, requestId, dto.accept);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a family connection request' })
  acceptRequest(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.acceptRequest(tenantId, user.sub, requestId);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a family connection request' })
  declineRequest(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.declineRequest(tenantId, user.sub, requestId);
  }

  @Put('visibility')
  @ApiOperation({ summary: 'Toggle family tree visibility (public/private)' })
  setVisibility(
    @Body() dto: SetVisibilityDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.familyService.setVisibility(user.sub, dto.isPublic);
  }

  // ── Parameterized routes ──

  @Get('visibility/:userId')
  @ApiOperation({ summary: 'Check if a user\'s family tree is public' })
  getVisibility(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.familyService.getVisibility(userId);
  }

  @Get('members/:userId')
  @ApiOperation({ summary: 'Get flat list of family members (with privacy redaction)' })
  getFlatFamily(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getFlatFamily(tenantId, userId);
  }

  @Get('tree/:userId')
  @ApiOperation({ summary: 'Get hierarchical family tree (with privacy redaction)' })
  getFamilyTree(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.getFamilyTree(tenantId, userId, user.sub);
  }

  @Delete(':relationshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a family connection (cascades inferred links)' })
  removeConnection(
    @Param('relationshipId', ParseUUIDPipe) relationshipId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    // Look up the connection to get both user IDs
    return this.familyService.removeConnectionById(tenantId, user.sub, relationshipId);
  }
}

// ════════════════════════════════════════════════════════════════════
// Admin family controller — separate so RoleGuard sits at class level
// and the routes group cleanly under /api/admin/family/*.
// ════════════════════════════════════════════════════════════════════

class AdminRemoveFamilyDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

@ApiTags('Admin Family')
@ApiBearerAuth()
@Controller('admin/family')
@UseGuards(JwtAuthGuard, RoleGuard)
@RequiresRole('admin', 'pastor')
@UseInterceptors(RlsContextInterceptor)
export class AdminFamilyController {
  constructor(private readonly familyService: FamilyService) {}

  @Get('relationships')
  @ApiOperation({
    summary: 'List family relationships for the current tenant (admin/pastor)',
    description:
      'Returns confirmed + inferred relationships with provenance. Filter by ?userId= to scope to one member; useful for child check-in safety reviews.',
  })
  @ApiResponse({ status: 200, description: '{ relationships: [...] }' })
  listRelationships(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('userId') userId?: string,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    return this.familyService.adminListRelationships(tenantId, userId);
  }

  @Delete('relationships/:relationshipId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin override: remove a family relationship (audited with reason)',
    description:
      'For correcting incorrect inferred siblings, divorces, or misidentified parent-child links. Reason is mandatory and surfaces in the audit log + targetUserId.',
  })
  @ApiResponse({ status: 200, description: '{ removed: true }' })
  @ApiResponse({ status: 404, description: 'Relationship not found in this tenant' })
  async adminRemove(
    @Param('relationshipId', ParseUUIDPipe) relationshipId: string,
    @Body() dto: AdminRemoveFamilyDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    const tenantId = user.app_metadata?.current_tenant_id!;
    await this.familyService.adminRemoveConnection(tenantId, relationshipId, user.sub, dto.reason);
    return { removed: true };
  }
}
