import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.comments.
 * tenant_id is denormalised from the parent post for RLS performance
 * (avoids a JOIN in every RLS policy evaluation).
 * The validate_comment_tenant DB trigger enforces tenant_id === post.tenant_id.
 */
@Entity({ schema: 'public', name: 'comments' })
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK → public.posts.id. ON DELETE CASCADE. */
  @Column({ type: 'uuid', name: 'post_id' })
  postId: string;

  /** Denormalised from the parent post. Must match post.tenant_id — enforced by DB trigger. */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Set from the authenticated user's JWT sub — never from user input. */
  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
