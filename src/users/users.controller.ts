import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { extname } from 'path';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  private supabase;

  constructor(private readonly usersService: UsersService) {
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
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  async getMe(@Query('userId') userId?: string) {
    // Extract userId from query parameter (sent by frontend)
    // In production, you'd extract this from JWT token
    if (!userId) {
      throw new Error('User ID required');
    }
    return this.usersService.findOne(userId);
  }

  @Patch('me')
  async updateMe(@Body() body: { userId: string; notificationSettings?: any }) {
    // Update current user's notification settings
    if (!body?.userId) {
      throw new Error('User ID required');
    }
    const { userId, ...updateData } = body;
    return this.usersService.update(userId, updateData);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  // POST /users/upload
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

  // POST /users/push-token
  @Post('push-token')
  async savePushToken(@Body() body: { userId: string; token: string }) {
    if (!body?.userId || !body?.token) {
      throw new Error('User ID and token required');
    }
    return this.usersService.update(body.userId, { fcmToken: body.token });
  }

  // POST /users/:id/habit
  @Post(':id/habit')
  async toggleHabit(@Param('id') id: string, @Body('type') type: 'word' | 'prayer' | 'service') {
    return this.usersService.toggleHabit(id, type);
  }
}