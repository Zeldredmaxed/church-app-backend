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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
