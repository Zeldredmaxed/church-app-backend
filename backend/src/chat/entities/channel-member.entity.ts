import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.channel_members.
 * Composite PK (channel_id, user_id) — a user can be in many channels.
 * Required for private/direct channels. Also tracked for public channels
 * (notification targeting).
 */
@Entity({ schema: 'public', name: 'channel_members' })
export class ChannelMember {
  @PrimaryColumn({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
