import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_executions' })
export class WorkflowExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'workflow_id' })
  workflowId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true, name: 'target_user_id' })
  targetUserId: string | null;

  @Column({ type: 'text', default: 'running' })
  status: string;

  @Column({ type: 'jsonb', name: 'trigger_data', default: '{}' })
  triggerData: Record<string, any>;

  @Column({ type: 'uuid', nullable: true, name: 'current_node_id' })
  currentNodeId: string | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'next_step_at' })
  nextStepAt: Date | null;
}
