import { Entity, Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

/**
 * Maps to public.follows.
 * Platform-wide user-to-user follow relationships — NOT tenant-scoped.
 * Composite primary key: (follower_id, following_id).
 * DB-level CHECK constraint prevents self-follows.
 */
@Entity({ schema: 'public', name: 'follows' })
export class Follow {
  /** The user who is following. */
  @PrimaryColumn({ type: 'uuid', name: 'follower_id' })
  followerId: string;

  /** The user being followed. */
  @PrimaryColumn({ type: 'uuid', name: 'following_id' })
  followingId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
