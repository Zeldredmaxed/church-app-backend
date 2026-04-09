import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { AssignTagDto } from './dto/assign-tag.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('tags')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'List tags for current tenant' })
  getTags() {
    return this.tagsService.getTags();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a tag (admin: manage_members)' })
  createTag(@Body() dto: CreateTagDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.tagsService.createTag(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tag (admin: manage_members)' })
  updateTag(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTagDto) {
    return this.tagsService.updateTag(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tag (admin: manage_members)' })
  deleteTag(@Param('id', ParseUUIDPipe) id: string) {
    return this.tagsService.deleteTag(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Assign tag to users' })
  assignTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTagDto,
    @CurrentUser() user: SupabaseJwtPayload,
  ) {
    return this.tagsService.assignTag(id, dto, user.sub);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove tag from a member' })
  removeTagFromMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.tagsService.removeTagFromMember(id, userId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List members with this tag (paginated)' })
  getTagMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.tagsService.getTagMembers(id, Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }
}
