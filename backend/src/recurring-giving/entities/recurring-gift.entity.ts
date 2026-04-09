import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'public', name: 'recurring_gifts' })
export class RecurringGift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'text', default: 'usd' })
  currency: string;

  @Column({ type: 'text' })
  frequency: string;

  @Column({ type: 'text', nullable: true, name: 'fund_name' })
  fundName: string | null;

  @Column({ type: 'text', nullable: true, unique: true, name: 'stripe_subscription_id' })
  stripeSubscriptionId: string | null;

  @Column({ type: 'text', default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
