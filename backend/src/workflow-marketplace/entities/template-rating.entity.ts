import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_template_ratings' })
export class TemplateRating {
  @PrimaryColumn({ type: 'uuid', name: 'template_id' })
  templateId: string;

  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  review: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
