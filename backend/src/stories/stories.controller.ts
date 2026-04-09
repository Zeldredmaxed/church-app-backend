import { Controller, Get, Post, Delete, Body, Param, ParseUUIDPipe, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Stories')
@ApiBearerAuth()
@Controller('stories')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Get stories feed (grouped by author, last 24h)' })
  getFeed(@CurrentUser() user: SupabaseJwtPayload) {
    return this.storiesService.getFeed(user.sub);
  }

  @Get('mine')
  @ApiOperation({ summary: "Get current user's active stories" })
  getMyStories(@CurrentUser() user: SupabaseJwtPayload) {
    return this.storiesService.getMyStories(user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new story' })
  createStory(@Body() dto: CreateStoryDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.storiesService.createStory(dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a story' })
  deleteStory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.storiesService.deleteStory(id, user.sub);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark story as viewed' })
  viewStory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SupabaseJwtPayload) {
    return this.storiesService.viewStory(id, user.sub);
  }
}
