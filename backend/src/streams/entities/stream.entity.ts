import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'public', name: 'streams' })
export class Stream {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt: Date;

  @Column({ type: 'timestamptz', name: 'ends_at', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'boolean', name: 'is_live', default: false })
  isLive: boolean;

  @Column({ type: 'text', name: 'mux_live_stream_id', nullable: true })
  muxLiveStreamId: string | null;

  @Column({ type: 'text', name: 'mux_playback_id', nullable: true })
  muxPlaybackId: string | null;

  /**
   * Secret RTMP push key. Returned ONCE from POST /api/streams to the
   * pastor who created the stream. Never include this in any GET
   * response — the service layer enforces this.
   */
  @Column({ type: 'text', name: 'mux_stream_key', nullable: true })
  muxStreamKey: string | null;

  @Column({ type: 'text', name: 'thumbnail_url', nullable: true })
  thumbnailUrl: string | null;

  @Column({ type: 'int', name: 'viewer_count', default: 0 })
  viewerCount: number;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
