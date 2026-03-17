import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, BadRequestException, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { SupportService } from '../support/support.service';
import { CreateSupportDto } from '../support/dto/create-support.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Alias controller for /support-tickets endpoints
@Controller('support-tickets')
export class SupportTicketsController {
  // Initialize Supabase Client
  private supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
  );

  constructor(private readonly supportService: SupportService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: CreateSupportDto) {
    return this.supportService.create(body);
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const fileExt = file.originalname.split('.').pop();
    const fileName = `support-${Date.now()}.${fileExt}`;

    const { error } = await this.supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException('Upload failed: ' + error.message);
    }

    const { data: publicUrlData } = this.supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    return { url: publicUrlData.publicUrl };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.supportService.findAll();
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() body: { status: string }) {
    return this.supportService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.supportService.remove(id);
  }
}
