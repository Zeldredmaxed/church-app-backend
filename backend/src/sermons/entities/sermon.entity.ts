import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'sermons' })
export class Sermon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  speaker: string;

  @Column({ type: 'text', nullable: true, name: 'audio_url' })
  audioUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'video_url' })
  videoUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'thumbnail_url' })
  thumbnailUrl: string | null;

  @Column({ type: 'int', nullable: true })
  duration: number | null;

  @Column({ type: 'text', nullable: true, name: 'series_name' })
  seriesName: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', name: 'is_featured', default: false })
  isFeatured: boolean;

  @Column({ type: 'text', nullable: true })
  transcript: string | null;

  @Column({ type: 'int', name: 'view_count', default: 0 })
  viewCount: number;

  @Column({ type: 'int', name: 'like_count', default: 0 })
  likeCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
