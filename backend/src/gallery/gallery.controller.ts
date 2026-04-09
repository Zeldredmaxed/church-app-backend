import { Controller, Get, Post, Body, Query, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GalleryService } from './gallery.service';
import { CreatePhotoDto } from './dto/create-photo.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

@ApiTags('Gallery')
@ApiBearerAuth()
@Controller('gallery')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  @ApiOperation({ summary: 'List gallery photos (cursor-paginated)' })
  getPhotos(
    @Query('album') album?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.galleryService.getPhotos(album ?? 'all', Math.min(parseInt(limit ?? '20', 10) || 20, 100), cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload a photo to the gallery' })
  createPhoto(@Body() dto: CreatePhotoDto, @CurrentUser() user: SupabaseJwtPayload) {
    return this.galleryService.createPhoto(dto, user.sub, user.app_metadata?.current_tenant_id!);
  }
}
