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

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
