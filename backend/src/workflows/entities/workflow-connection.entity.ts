import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'public', name: 'workflow_connections' })
export class WorkflowConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'workflow_id' })
  workflowId: string;

  @Column({ type: 'uuid', name: 'from_node_id' })
  fromNodeId: string;

  @Column({ type: 'uuid', name: 'to_node_id' })
  toNodeId: string;

  @Column({ type: 'text', default: 'default' })
  branch: string;
}
