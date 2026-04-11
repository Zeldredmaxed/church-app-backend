import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.chat_messages.
 * Immutable once created — no UPDATE or DELETE RLS policies.
 * Tenant isolation is enforced by joining to chat_channels in RLS.
 */
@Entity({ schema: 'public', name: 'chat_messages' })
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** Optional media attachment URL (image, video, or voice note). */
  @Column({ type: 'text', nullable: true, name: 'media_url' })
  mediaUrl: string | null;

  /** Media type: image, video, or audio (for voice notes). NULL when no media. */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'media_type' })
  mediaType: 'image' | 'video' | 'audio' | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
