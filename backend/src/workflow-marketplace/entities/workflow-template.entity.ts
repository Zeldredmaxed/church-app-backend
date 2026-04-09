import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_templates' })
export class WorkflowTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'publisher_tenant_id', nullable: true })
  publisherTenantId: string | null;

  @Column({ type: 'uuid', name: 'publisher_user_id', nullable: true })
  publisherUserId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', default: 'general' })
  category: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', name: 'trigger_type' })
  triggerType: string;

  @Column({ type: 'jsonb', name: 'trigger_config', default: '{}' })
  triggerConfig: Record<string, any>;

  @Column({ type: 'jsonb', default: '[]' })
  nodes: any[];

  @Column({ type: 'jsonb', default: '[]' })
  connections: any[];

  @Column({ type: 'int', name: 'price_cents', default: 0 })
  priceCents: number;

  @Column({ type: 'text', default: 'usd' })
  currency: string;

  @Column({ type: 'boolean', name: 'is_official', default: false })
  isOfficial: boolean;

  @Column({ type: 'boolean', name: 'is_published', default: true })
  isPublished: boolean;

  @Column({ type: 'int', name: 'install_count', default: 0 })
  installCount: number;

  @Column({ type: 'int', name: 'rating_sum', default: 0 })
  ratingSum: number;

  @Column({ type: 'int', name: 'rating_count', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
