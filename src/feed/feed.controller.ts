import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Post()
  create(@Body() body: { userId: string; content: string; imageUrl?: string; videoUrl?: string; location?: string; taggedUserIds?: string[] }) {
    return this.feedService.create(body.userId, body);
  }

  @Get()
  findAll(@Query('userId') userId?: string) {
    return this.feedService.findAll(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.feedService.findOne(id);
  }

  @Post(':id/react')
  toggleReaction(
    @Param('id') postId: string,
    @Body() body: { userId: string; type: string }
  ) {
    return this.feedService.toggleReaction(body.userId, postId, body.type);
  }

  @Post(':id/comments')
  async addComment(@Param('id') postId: string, @Body() body: { userId: string, content: string }) {
    return this.feedService.addComment(postId, body.userId, body.content);
  }
}
