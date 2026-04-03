import {
  Controller,
  Get,
  Post,
  Patch,
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
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { GetMembersDto } from './dto/get-members.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Memberships')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

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

  @Get('tenants/:tenantId/members')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List tenant members with cursor-based pagination' })
  @ApiResponse({ status: 200, description: 'Paginated member list with nextCursor' })
  getMembers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: GetMembersDto,
  ) {
    return this.membershipsService.getMembers(tenantId, query.cursor, query.limit);
  }

  @Patch('tenants/:tenantId/members/:userId/role')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Update a member role (admin only)' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 404, description: 'Membership not found or not authorized' })
  updateRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.membershipsService.updateRole(tenantId, userId, dto);
  }

  @Delete('tenants/:tenantId/members/:userId')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from tenant (admin or self)' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 404, description: 'Membership not found or not authorized' })
  removeMember(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.membershipsService.removeMember(tenantId, userId);
  }
}
