import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'fundraisers' })
export class Fundraiser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  overview: string;

  @Column({ type: 'text' })
  category: string;

  /** Target amount in cents. */
  @Column({ type: 'bigint', name: 'target_amount' })
  targetAmount: number;

  /** Denormalized raised amount in cents, updated by DB trigger. */
  @Column({ type: 'bigint', name: 'raised_amount', default: 0 })
  raisedAmount: number;

  @Column({ type: 'text', default: 'USD' })
  currency: string;

  @Column({ type: 'text', nullable: true, name: 'image_url' })
  imageUrl: string | null;

  @Column({ type: 'text', default: 'active' })
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt: Date;

  /** Denormalized backer count, updated by DB trigger. */
  @Column({ type: 'int', name: 'backer_count', default: 0 })
  backerCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
