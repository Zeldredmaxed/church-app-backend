import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';

@Module({
  controllers: [GalleryController],
  providers: [GalleryService, RlsContextInterceptor],
})
export class GalleryModule {}
