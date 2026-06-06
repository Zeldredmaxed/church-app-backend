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

  /** Derived from the JWT current_tenant_id — never from user input. NULL for global posts. */
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

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

  /**
   * Normalized pinch-zoom-crop rectangle for video posts.
   * { x, y, width, height } in [0..1] with optional aspectRatio.
   * Playback applies it via CSS until a server-side transcode worker
   * re-encodes the asset with the crop baked in. Null for un-cropped video.
   */
  @Column({ type: 'jsonb', nullable: true, name: 'video_crop_rect' })
  videoCropRect: any | null;

  /**
   * width / height of the source media. Image posts get this on upload
   * (sharp probe in /media/finalize-image); video posts get it from the
   * Mux asset.ready webhook. Lets the mobile feed pre-allocate the
   * right cell height and avoid the first-paint layout shift.
   * NULL for text posts or before transcode completes.
   */
  @Column({ type: 'real', nullable: true, name: 'media_aspect' })
  mediaAspect: number | null;

  /**
   * Video transcode state. NULL for text/image posts. Updated by Mux
   * webhooks (video.asset.ready → 'ready', video.asset.errored or
   * video.upload.errored → 'failed'). 'pending' is the initial state
   * set when a post is created with a videoMuxUploadId.
   */
  @Column({ type: 'text', nullable: true, name: 'transcode_status' })
  transcodeStatus: 'pending' | 'ready' | 'failed' | null;

  /**
   * Badge definition this post is celebrating ("Share to feed" from the
   * mobile AchievementModal). The post's content still carries the user's
   * caption; the renderer overlays a badge card based on this FK. ON
   * DELETE SET NULL — if the church deletes the badge later, the post
   * survives as a normal text post.
   */
  @Column({ type: 'uuid', nullable: true, name: 'shared_badge_id' })
  sharedBadgeId: string | null;

  /**
   * Instagram-style archive flag. When true, the post is hidden from every
   * feed/search/profile view and only appears in the owner's archive list.
   * Toggled via POST/DELETE /api/posts/:id/archive.
   */
  @Column({ type: 'boolean', name: 'is_archived', default: false })
  isArchived: boolean;

  /**
   * Sermon this post is discussing. Set when the post is created from the
   * sermon detail screen's "Start a discussion" or "Comment" CTAs.
   * Comments on this post are the sermon's discussion thread — no
   * dedicated sermon_comments table is needed. ON DELETE SET NULL keeps
   * the discussion alive as a normal post if the sermon is removed.
   */
  @Column({ type: 'uuid', nullable: true, name: 'linked_sermon_id' })
  linkedSermonId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
