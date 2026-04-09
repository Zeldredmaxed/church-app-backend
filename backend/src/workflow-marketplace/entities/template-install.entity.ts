import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_template_installs' })
export class TemplateInstall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'template_id' })
  templateId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'installed_by' })
  installedBy: string;

  @Column({ type: 'uuid', name: 'workflow_id', nullable: true })
  workflowId: string | null;

  @Column({ type: 'int', name: 'amount_paid', default: 0 })
  amountPaid: number;

  @Column({ type: 'timestamptz', name: 'installed_at', default: () => 'now()' })
  installedAt: Date;
}
