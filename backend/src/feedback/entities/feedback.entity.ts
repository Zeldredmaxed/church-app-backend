import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'feedback' })
export class Feedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  type: 'node_request' | 'bug_report' | 'feature_request';

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', default: 'medium' })
  priority: 'low' | 'medium' | 'high';

  @Column({ type: 'text', default: 'open' })
  status: 'open' | 'in_progress' | 'completed' | 'closed';

  @Column({ type: 'uuid', name: 'submitted_by' })
  submittedBy: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
