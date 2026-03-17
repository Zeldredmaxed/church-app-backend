import { Controller, Get, Post, Body, Param, Query, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Delete } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { FeedService } from './feed.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('feed')
export class FeedController {
  // Initialize Supabase Client
  private supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
  );

  constructor(private readonly feedService: FeedService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: { userId: string; content: string; imageUrl?: string; videoUrl?: string; location?: string; taggedUserIds?: string[] }) {
    return this.feedService.create(body.userId, body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('userId') userId?: string) {
    return this.feedService.findAll(userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.feedService.findOne(id);
  }

  @Post(':id/view')
  @UseGuards(JwtAuthGuard)
  async viewPost(@Param('id') id: string) {
    // Just bump the timestamp
    await this.feedService.bumpPost(id);
    return { status: 'bumped' };
  }

  @Post(':id/react')
  @UseGuards(JwtAuthGuard)
  toggleReaction(
    @Param('id') postId: string,
    @Body() body: { userId: string; type: string }
  ) {
    return this.feedService.toggleReaction(body.userId, postId, body.type);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  async addComment(@Param('id') postId: string, @Body() body: { userId: string, content: string }) {
    return this.feedService.addComment(postId, body.userId, body.content);
  }

  // POST /feed/upload
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Generate unique filename with timestamp
    const fileExt = file.originalname.split('.').pop();
    const fileName = `feed-${Date.now()}.${fileExt}`;

    // Upload to Supabase 'uploads' bucket
    const { error } = await this.supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException('Upload failed: ' + error.message);
    }

    // Get Public URL
    const { data: publicUrlData } = this.supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    return { url: publicUrlData.publicUrl };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string, @Body() body: { userId: string }) {
    return this.feedService.delete(id, body.userId);
  }
}
