import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  // Initialize Supabase Client
  private supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
  );

  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Query('userId') userId?: string) {
    // Extract userId from query parameter (sent by frontend)
    // In production, you'd extract this from JWT token
    if (!userId) {
      throw new Error('User ID required');
    }
    return this.usersService.findOne(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@Body() body: { userId: string; notificationSettings?: any }) {
    // Update current user's notification settings
    if (!body?.userId) {
      throw new Error('User ID required');
    }
    const { userId, ...updateData } = body;
    return this.usersService.update(userId, updateData);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  // POST /users/upload - Generic file upload (used during registration before user exists)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  // Note: No auth guard - allows upload before registration completes
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const fileExt = file.originalname.split('.').pop();
    const fileName = `registration-${Date.now()}.${fileExt}`;

    const { error } = await this.supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) throw new BadRequestException('Upload failed: ' + error.message);

    const { data: publicUrlData } = this.supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    return { url: publicUrlData.publicUrl };
  }

  @Post(':id/upload-avatar') // We need the ID to know who to delete
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file')) // Uses MemoryStorage by default (Good for Cloud)
  async uploadAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    // 1. Get current user to check for old photo
    const user = await this.usersService.findOne(id);

    // 2. Delete Old Photo (If exists)
    if (user?.avatarUrl) {
      try {
        // Extract filename from the full URL
        // URL format: https://[...]/storage/v1/object/public/uploads/FILENAME.jpg
        const oldFileName = user.avatarUrl.split('/uploads/').pop();
        if (oldFileName) {
          await this.supabase.storage.from('uploads').remove([oldFileName]);
          console.log('Deleted old image:', oldFileName);
        }
      } catch (e) {
        console.error('Error deleting old image:', e);
      }
    }

    // 3. Upload New Photo
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${id}-${Date.now()}.${fileExt}`; // Unique name

    const { error } = await this.supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) throw new BadRequestException('Upload failed: ' + error.message);

    // 4. Get Public URL
    const { data: publicUrlData } = this.supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    const fullUrl = publicUrlData.publicUrl;

    // 5. Update Database with FULL URL
    await this.usersService.update(id, { avatarUrl: fullUrl });

    return { url: fullUrl };
  }

  // POST /users/push-token
  @Post('push-token')
  @UseGuards(JwtAuthGuard)
  async savePushToken(@Body() body: { userId: string; token: string }) {
    if (!body?.userId || !body?.token) {
      throw new Error('User ID and token required');
    }
    return this.usersService.update(body.userId, { fcmToken: body.token });
  }

  // POST /users/:id/habit
  @Post(':id/habit')
  @UseGuards(JwtAuthGuard)
  async toggleHabit(@Param('id') id: string, @Body('type') type: 'word' | 'prayer' | 'service') {
    return this.usersService.toggleHabit(id, type);
  }

  // Search Filter
  @Post('filter')
  @UseGuards(JwtAuthGuard)
  filter(@Body() body: any) {
    return this.usersService.filterUsers(body);
  }
}