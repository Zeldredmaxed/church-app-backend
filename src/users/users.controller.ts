import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads', // Save to this folder
      filename: (req, file, cb) => {
        // Generate a random name (e.g. random123.jpg) so files don't clash
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
  }))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    // Return the URL so the frontend can save it
    return { url: `/uploads/${file.filename}` };
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