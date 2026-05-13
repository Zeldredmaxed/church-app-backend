import {
  Controller,
  Get,
  Post,
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
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { GetCommentsDto } from './dto/get-comments.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Comments')
@ApiBearerAuth()
@Controller('posts/:postId/comments')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a comment on a post' })
  @ApiResponse({ status: 201, description: 'Comment created. Notification sent to post author.' })
  @ApiResponse({ status: 404, description: 'Post not found in current tenant' })
  createComment(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(postId, dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List comments for a post (newest first)' })
  @ApiResponse({ status: 200, description: 'Paginated array of comments' })
  @ApiResponse({ status: 404, description: 'Post not found in current tenant' })
  getComments(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: GetCommentsDto,
  ) {
    return this.commentsService.getComments(postId, query);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a comment',
    description: 'Author can delete their own comment; tenant admin can delete any comment in the tenant. RLS DELETE policy enforces both.',
  })
  @ApiResponse({ status: 200, description: '{ deleted: true }' })
  @ApiResponse({ status: 403, description: 'Not the author and not an admin' })
  @ApiResponse({ status: 404, description: 'Comment not found in current tenant' })
  deleteComment(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.commentsService.deleteComment(postId, commentId);
  }
}
