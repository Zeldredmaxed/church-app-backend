import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.chat_channels.
 * Tenant-scoped chat channels with three types:
 *   - public: visible to all tenant members
 *   - private: invite-only, managed by admin/pastor
 *   - direct: 1:1 messaging between two users
 */
@Entity({ schema: 'public', name: 'chat_channels' })
export class ChatChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text', nullable: true })
  name: string | null;

  @Column({ type: 'text' })
  type: 'public' | 'private' | 'direct';

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
