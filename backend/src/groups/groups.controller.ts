import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a group (cascades members + messages)' })
  deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupsService.deleteGroup(id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List group members (cursor-paginated)' })
  getGroupMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getGroupMembers(id, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join a group (idempotent)' })
  joinGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.groupsService.joinGroup(id, user.sub);
  }

  @Delete(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a group' })
  leaveGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.groupsService.leaveGroup(id, user.sub);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'List group messages (cursor-paginated)' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.groupsService.getMessages(id, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
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
