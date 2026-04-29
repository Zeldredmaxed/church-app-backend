import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { JoinRequestDto, DenyRequestDto } from './dto/join-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List groups (cursor-paginated)' })
  getGroups(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getGroups(user.sub, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single group with membership status' })
  getGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.groupsService.getGroup(id, user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a group' })
  createGroup(@Body() dto: CreateGroupDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.groupsService.createGroup(dto, user.sub);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a group' })
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.updateGroup(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group (cascades members + messages)' })
  deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.deleteGroup(id);
  }

  // ── Membership ──

  @Get(':id/members')
  @ApiOperation({ summary: 'List group members (cursor-paginated)' })
  getGroupMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getGroupMembers(id, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Admin: directly add a user to the group',
    description: 'Caller must be a tenant admin/pastor or the group creator. Idempotent. If the target has a pending join request, it is auto-approved.',
  })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.addMember(id, dto.userId, user.sub);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: remove a user from the group',
    description: 'Caller must be a tenant admin/pastor or the group creator.',
  })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.removeMember(id, userId, user.sub);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request to join a group',
    description: 'Creates a pending request that an admin must approve. Returns { status: "pending" | "already_member", requestId? }. Replaces the previous open-join behavior.',
  })
  requestToJoin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JoinRequestDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.requestToJoin(id, user.sub, dto);
  }

  @Delete(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a group' })
  leaveGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.groupsService.leaveGroup(id, user.sub);
  }

  // ── Join requests (admin) ──

  @Get(':id/join-requests')
  @ApiOperation({
    summary: 'Admin: list join requests for a group (default: pending only)',
    description: 'Caller must be a tenant admin/pastor or the group creator.',
  })
  getJoinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('status') status?: 'pending' | 'approved' | 'denied' | 'all',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getJoinRequests(
      id,
      user.sub,
      status ?? 'pending',
      Math.min(parseInt(limit ?? '20', 10) || 20, 100),
      cursor,
    );
  }

  @Post(':id/join-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: approve a pending join request → adds user to group' })
  approveJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.approveJoinRequest(id, requestId, user.sub);
  }

  @Post(':id/join-requests/:requestId/deny')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: deny a pending join request' })
  denyJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: DenyRequestDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.denyJoinRequest(id, requestId, user.sub, dto);
  }

  @Delete(':id/join-requests/me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw your own pending join request for a group' })
  withdrawMyRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.withdrawMyRequest(id, user.sub);
  }

  // ── Messages ──

  @Get(':id/messages')
  @ApiOperation({ summary: 'List group messages (members only)' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getMessages(id, user.sub, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a message to a group' })
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendGroupMessageDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.groupsService.sendMessage(id, dto, user.sub);
  }
}
