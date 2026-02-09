import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient } from '@supabase/supabase-js';
import { SupportService } from './support.service';
import { CreateSupportDto } from './dto/create-support.dto';

@Controller('support')
export class SupportController {
  // Initialize Supabase Client
  private supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_KEY ?? '',
  );

  constructor(private readonly supportService: SupportService) {}

  @Post()
  create(@Body() body: CreateSupportDto) {
    return this.supportService.create(body);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Generate unique filename with timestamp
    const fileExt = file.originalname.split('.').pop();
    const fileName = `support-${Date.now()}.${fileExt}`;

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

  @Get()
  findAll() {
    return this.supportService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { status: string }) {
    return this.supportService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.supportService.remove(id);
  }
}
