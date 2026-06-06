import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to public.shop_orders — one row per purchase.
 *
 * Status lifecycle (driven by Stripe webhooks):
 *   pending → paid     (payment_intent.succeeded)
 *   pending → failed   (payment_intent.payment_failed)
 *   paid    → refunded (charge.refunded)
 */
@Entity({ schema: 'public', name: 'shop_orders' })
export class ShopOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** Nullable so a GDPR erasure on the user doesn't drop the ledger row. */
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'uuid', name: 'option_ids', array: true, default: () => "'{}'" })
  optionIds: string[];

  /** Final charged amount in CENTS (base price + option deltas) × quantity. */
  @Column({ type: 'bigint', name: 'total_cents' })
  totalCents: string;

  @Column({ type: 'text', name: 'stripe_payment_intent_id', nullable: true, unique: true })
  stripePaymentIntentId: string | null;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'paid' | 'failed' | 'refunded';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
