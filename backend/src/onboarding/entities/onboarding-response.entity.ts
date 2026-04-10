import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'onboarding_responses' })
export class OnboardingResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'form_id' })
  formId: string;

  @Column({ type: 'jsonb', default: '{}' })
  responses: Record<string, any>;

  @Column({ type: 'timestamptz', name: 'submitted_at', default: () => 'now()' })
  submittedAt: Date;
}
