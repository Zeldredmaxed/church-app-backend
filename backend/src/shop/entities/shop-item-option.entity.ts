import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Maps to public.shop_item_options — per-item variant (size, color, etc.) with
 * an optional CENTS delta added to the base price when the buyer picks it.
 */
@Entity({ schema: 'public', name: 'shop_item_options' })
export class ShopItemOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'item_id' })
  itemId: string;

  @Column({ type: 'text' })
  label: string;

  /** Added to the item's price_cents when this option is selected. */
  @Column({ type: 'bigint', name: 'price_delta_cents', default: 0 })
  priceDeltaCents: string;
}
