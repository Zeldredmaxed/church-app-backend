import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.transactions.
 * Records donation/giving payments processed through Stripe Connect.
 *
 * Status lifecycle (driven by Stripe webhooks):
 *   pending → succeeded  (payment_intent.succeeded)
 *   pending → failed     (payment_intent.payment_failed)
 *   succeeded → refunded (charge.refunded)
 *
 * No UPDATE RLS policy for 'authenticated' role — only the service role
 * (webhook processor) can update transaction status.
 */
@Entity({ schema: 'public', name: 'transactions' })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Nullable — set to NULL when a user exercises their GDPR right to erasure. */
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  /** Donation amount in the smallest displayable unit (e.g., 100.00 = $100). */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'text', default: 'usd' })
  currency: string;

  /** Stripe PaymentIntent ID — unique, used for webhook reconciliation. */
  @Column({ type: 'text', name: 'stripe_payment_intent_id', unique: true })
  stripePaymentIntentId: string;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
