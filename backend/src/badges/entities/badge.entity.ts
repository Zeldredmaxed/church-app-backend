import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'badges' })
export class Badge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', default: 'award' })
  icon: string;

  @Column({ type: 'text', default: '#6366f1' })
  color: string;

  @Column({ type: 'text', default: 'bronze' })
  tier: string;

  @Column({ type: 'text', default: 'custom' })
  category: string;

  @Column({ type: 'jsonb', nullable: true, name: 'auto_award_rule' })
  autoAwardRule: Record<string, any> | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'int', name: 'display_order', default: 0 })
  displayOrder: number;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
