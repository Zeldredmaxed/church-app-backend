import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { AdminArchivePostDto } from './dto/admin-archive-post.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RoleGuard, RequiresRole } from '../common/guards/role.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Posts')
@ApiBearerAuth()
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
  ) {}

  @Post()
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a church-internal post' })
  @ApiResponse({ status: 201, description: 'Post created' })
  createPost(@CurrentUser() user: SupabaseJwtPayload, @Body() dto: CreatePostDto) {
    return this.postsService.createPost(dto, user.sub);
  }

  @Post('global')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a global post (visible to all users, triggers fan-out)' })
  @ApiResponse({ status: 201, description: 'Global post created and fan-out queued' })
  createGlobalPost(@CurrentUser() user: SupabaseJwtPayload, @Body() dto: CreatePostDto) {
    return this.postsService.createGlobalPost(dto, user.sub);
  }

  @Get()
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List paginated posts for current tenant (newest first)' })
  @ApiResponse({ status: 200, description: 'Array of posts with pagination metadata' })
  getPosts(@CurrentUser() user: SupabaseJwtPayload, @Query() query: GetPostsDto) {
    return this.postsService.getPosts(query, user.sub);
  }

  @Get('saved')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List saved/bookmarked posts for the current user' })
  @ApiResponse({ status: 200, description: 'Same shape as GET /api/posts — posts + total' })
  getSavedPosts(@CurrentUser() user: SupabaseJwtPayload, @Query() query: GetPostsDto) {
    return this.postsService.getSavedPosts(user.sub, query.limit ?? 20, query.offset ?? 0);
  }

  @Get('archive')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: "List the caller's own archived posts" })
  @ApiResponse({ status: 200, description: 'Same shape as GET /api/posts — owner-only' })
  getArchivedPosts(@CurrentUser() user: SupabaseJwtPayload, @Query() query: GetPostsDto) {
    return this.postsService.getArchivedPosts(user.sub, query.limit ?? 20, query.offset ?? 0);
  }

  @Get(':id')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get a single post by ID' })
  @ApiResponse({ status: 200, description: 'Post object' })
  @ApiResponse({ status: 404, description: 'Post not found or not in current tenant' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.findOne(id, user.sub);
  }

  @Patch(':id')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Update post content (author only)' })
  @ApiResponse({ status: 200, description: 'Updated post' })
  @ApiResponse({ status: 404, description: 'Post not found or not the author' })
  updatePost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.updatePost(id, dto, user.sub);
  }

  @Delete(':id')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a post (author or admin)' })
  @ApiResponse({ status: 204, description: 'Post deleted' })
  @ApiResponse({ status: 404, description: 'Post not found or not authorized' })
  deletePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.deletePost(id);
  }

  @Post(':id/like')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Like a post (idempotent)' })
  @ApiResponse({ status: 201, description: 'Liked' })
  likePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.likePost(id, user.sub);
  }

  @Delete(':id/like')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlike a post (idempotent)' })
  @ApiResponse({ status: 204, description: 'Unliked' })
  unlikePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.unlikePost(id, user.sub);
  }

  @Post(':id/save')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save/bookmark a post (idempotent)' })
  @ApiResponse({ status: 201, description: 'Saved' })
  savePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.savePost(id, user.sub);
  }

  @Delete(':id/save')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsave/unbookmark a post (idempotent)' })
  @ApiResponse({ status: 204, description: 'Unsaved' })
  unsavePost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.postsService.unsavePost(id, user.sub);
  }

  @Post(':id/archive')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a post (author only) — hides it from every feed/search/profile',
    description: "The post is still accessible to the author through GET /api/posts/archive and GET /api/posts/:id, but is filtered out of all public-facing queries.",
  })
  @ApiResponse({ status: 200, description: '{ archived: true }' })
  @ApiResponse({ status: 404, description: 'Post not found or caller is not the author' })
  archivePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.archivePost(id);
  }

  @Delete(':id/archive')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive a post (author only) — restores it to feeds' })
  @ApiResponse({ status: 200, description: '{ archived: false }' })
  @ApiResponse({ status: 404, description: 'Post not found or caller is not the author' })
  unarchivePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.unarchivePost(id);
  }

  @Post(':id/admin-archive')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin moderation — archive someone else\'s post',
    description:
      'Hides the post from every feed/search/profile (same effect as the author archiving). Author archive routes still enforce author_id = auth.uid(); this route bypasses that constraint for admin/pastor moderation and writes an audit log entry with target_user_id = original author.',
  })
  @ApiResponse({ status: 200, description: '{ archived: true }' })
  @ApiResponse({ status: 403, description: 'Caller is not admin/pastor' })
  @ApiResponse({ status: 404, description: 'Post not found in current tenant' })
  adminArchivePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminArchivePostDto,
  ) {
    return this.postsService.adminArchivePost(id, true, dto.reason ?? null);
  }

  @Delete(':id/admin-archive')
  @UseGuards(RoleGuard)
  @RequiresRole('admin', 'pastor')
  @UseInterceptors(RlsContextInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin moderation — restore an archived post by another user',
    description:
      'Inverse of POST /admin-archive. Restores the post to all feed/search/profile surfaces and records the action in the audit log.',
  })
  @ApiResponse({ status: 200, description: '{ archived: false }' })
  @ApiResponse({ status: 403, description: 'Caller is not admin/pastor' })
  @ApiResponse({ status: 404, description: 'Post not found in current tenant' })
  adminUnarchivePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminArchivePostDto,
  ) {
    return this.postsService.adminArchivePost(id, false, dto.reason ?? null);
  }
}
