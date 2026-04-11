import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'fundraiser_donations' })
export class FundraiserDonation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'fundraiser_id' })
  fundraiserId: string;

  @Column({ type: 'uuid', name: 'donor_id' })
  donorId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Amount in cents. Minimum 100 ($1.00). */
  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'text', nullable: true, name: 'payment_intent_id' })
  paymentIntentId: string | null;

  @Column({ type: 'text', name: 'payment_status', default: 'pending' })
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'refunded';

  @Column({ type: 'boolean', default: false })
  anonymous: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
