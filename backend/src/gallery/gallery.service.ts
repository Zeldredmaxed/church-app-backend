import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { rlsStorage } from '../common/storage/rls.storage';
import { GalleryPhoto } from './entities/gallery-photo.entity';
import { CreatePhotoDto } from './dto/create-photo.dto';

@Injectable()
export class GalleryService {
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async getPhotos(album: string, limit: number, cursor?: string) {
    const { queryRunner } = this.getRlsContext();
    const params: any[] = [limit + 1];
    let sql = `SELECT * FROM public.gallery_photos`;

    const conditions: string[] = [];

    if (album !== 'all') {
      params.push(album);
      conditions.push(`album = $${params.length}`);
    }

    if (cursor) {
      params.push(cursor);
      conditions.push(`id < $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY created_at DESC LIMIT $1`;

    const rows = await queryRunner.query(sql, params);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      photos: items.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        uploadedBy: r.uploaded_by,
        mediaUrl: r.media_url,
        album: r.album,
        createdAt: r.created_at,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async createPhoto(dto: CreatePhotoDto, userId: string, tenantId: string) {
    const { queryRunner } = this.getRlsContext();
    const photo = queryRunner.manager.create(GalleryPhoto, {
      tenantId,
      uploadedBy: userId,
      mediaUrl: dto.mediaUrl,
      album: dto.album ?? 'general',
    });
    return queryRunner.manager.save(GalleryPhoto, photo);
  }
}
