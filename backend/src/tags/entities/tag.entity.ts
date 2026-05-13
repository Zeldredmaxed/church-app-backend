import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'tags' })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: '#6366f1' })
  color: string;

  /**
   * When set, assigning this tag promotes the user to this role in
   * tenant_memberships; removing the tag (if no other tag grants the same
   * role) demotes them back to 'member'. NULL = plain label tag with no
   * role side-effect.
   */
  @Column({ type: 'text', nullable: true, name: 'grants_role' })
  grantsRole: 'admin' | 'pastor' | 'moderator' | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
