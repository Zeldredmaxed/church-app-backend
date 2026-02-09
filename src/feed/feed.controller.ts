import { Controller, Get, Post, Body, Param, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  // Initialize Supabase Client
  private supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
  );

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

  // POST /feed/upload
  @Post('upload')
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
}
