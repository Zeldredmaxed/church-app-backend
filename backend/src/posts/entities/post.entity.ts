import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Maps to public.posts.
 * Phase 1: tenant_id is always set (internal church posts only).
 * Phase 2: tenant_id will be nullable for global/public posts.
 */
@Entity({ schema: 'public', name: 'posts' })
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Always set in Phase 1. Derived from the JWT current_tenant_id — never from user input. */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Set from the authenticated user's JWT sub — never from user input. */
  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @Column({ type: 'text' })
  content: string;

  /**
   * Content type classification: 'text' (default), 'image', or 'video'.
   * Enforced by a CHECK constraint at the DB level.
   */
  @Column({ type: 'text', name: 'media_type', default: 'text' })
  mediaType: string;

  /** 'public' = visible to all tenant members; 'private' = author only. */
  @Column({ type: 'text', default: 'public' })
  visibility: 'public' | 'private';

  /**
   * S3 object URL for image posts. NULL for text-only and video posts.
   * The frontend uses this URL directly (S3 public read or pre-signed GET).
   */
  @Column({ type: 'text', nullable: true, name: 'media_url' })
  mediaUrl: string | null;

  /** Set by the video-processing BullMQ worker after Mux transcoding. NULL for text/image posts. */
  @Column({ type: 'text', nullable: true, name: 'video_mux_playback_id' })
  videoMuxPlaybackId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
