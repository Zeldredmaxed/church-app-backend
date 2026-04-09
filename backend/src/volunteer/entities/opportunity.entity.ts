import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'volunteer_opportunities' })
export class Opportunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text', name: 'role_name' })
  roleName: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  schedule: string;

  @Column({ type: 'int', nullable: true, name: 'spots_available' })
  spotsAvailable: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
