import { Controller, Get, Post, Body, Param, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { extname } from 'path';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  private supabase;

  constructor(private readonly feedService: FeedService) {
    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('Supabase credentials not found. File uploads will fail.');
    } else {
      this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
  }

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
      throw new Error('No file uploaded');
    }

    if (!this.supabase) {
      throw new Error('Supabase not initialized. Please check SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.');
    }

    // Generate a unique filename (timestamp + random)
    const timestamp = Date.now();
    const randomStr = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
    const filename = `${timestamp}-${randomStr}${extname(file.originalname)}`;

    // Upload to Supabase Storage
    const { data, error } = await this.supabase.storage
      .from('uploads')
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    // Construct the public URL
    const supabaseUrl = process.env.SUPABASE_URL;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/uploads/${filename}`;

    return { url: publicUrl };
  }
}
