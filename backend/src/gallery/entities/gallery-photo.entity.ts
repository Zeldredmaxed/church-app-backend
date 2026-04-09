import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'gallery_photos' })
export class GalleryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'uploaded_by' })
  uploadedBy: string;

  @Column({ type: 'text', name: 'media_url' })
  mediaUrl: string;

  @Column({ type: 'text', default: 'general' })
  album: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
