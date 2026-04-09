import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_nodes' })
export class WorkflowNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'workflow_id' })
  workflowId: string;

  @Column({ type: 'text', name: 'node_type' })
  nodeType: string;

  @Column({ type: 'jsonb', name: 'node_config', default: '{}' })
  nodeConfig: Record<string, any>;

  @Column({ type: 'float', name: 'position_x', default: 0 })
  positionX: number;

  @Column({ type: 'float', name: 'position_y', default: 0 })
  positionY: number;

  @Column({ type: 'text', nullable: true })
  label: string | null;
}
