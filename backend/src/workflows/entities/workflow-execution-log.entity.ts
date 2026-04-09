import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_execution_logs' })
export class WorkflowExecutionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'execution_id' })
  executionId: string;

  @Column({ type: 'uuid', name: 'node_id' })
  nodeId: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'jsonb', name: 'input_data', default: '{}' })
  inputData: Record<string, any>;

  @Column({ type: 'jsonb', name: 'output_data', default: '{}' })
  outputData: Record<string, any>;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', name: 'executed_at', default: () => 'now()' })
  executedAt: Date;
}
