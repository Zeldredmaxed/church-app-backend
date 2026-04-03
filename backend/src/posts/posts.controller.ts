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
import { DataSource } from 'typeorm';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { GetPostsDto } from './dto/get-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
    private readonly dataSource: DataSource,
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
    return this.postsService.createGlobalPost(dto, user.sub, this.dataSource);
  }

  @Get()
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'List paginated posts for current tenant (newest first)' })
  @ApiResponse({ status: 200, description: 'Array of posts with pagination metadata' })
  getPosts(@Query() query: GetPostsDto) {
    return this.postsService.getPosts(query);
  }

  @Get(':id')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Get a single post by ID' })
  @ApiResponse({ status: 200, description: 'Post object' })
  @ApiResponse({ status: 404, description: 'Post not found or not in current tenant' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.postsService.findOne(id);
  }

  @Patch(':id')
  @UseInterceptors(RlsContextInterceptor)
  @ApiOperation({ summary: 'Update post content (author only)' })
  @ApiResponse({ status: 200, description: 'Updated post' })
  @ApiResponse({ status: 404, description: 'Post not found or not the author' })
  updatePost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.postsService.updatePost(id, dto);
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
}
