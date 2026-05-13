import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ schema: 'public', name: 'stories' })
export class Story {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text', nullable: true, name: 'media_url' })
  mediaUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'media_type' })
  mediaType: 'image' | 'video' | null;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @Column({ type: 'text', nullable: true, name: 'background_color' })
  backgroundColor: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  /**
   * When true, the story is excluded from the feed and from the author's
   * active "my stories" list. Archived stories persist beyond expires_at,
   * giving the owner a place to keep stories they want to save.
   */
  @Column({ type: 'boolean', name: 'is_archived', default: false })
  isArchived: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;
}
