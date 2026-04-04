import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Maps to public.roles.
 * Reference table defining standard roles and their default permission sets.
 * Used as a template when assigning roles.
 */
@Entity({ schema: 'public', name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  name: string;

  @Column({ type: 'jsonb', default: {} })
  permissions: Record<string, boolean>;
}
