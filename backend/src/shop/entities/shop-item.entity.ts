import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps to public.shop_items — products a tenant sells through the in-app store.
 * Schema owned by migrations/088_shop.sql. synchronize is disabled.
 *
 * Money is stored in CENTS (BIGINT). Divide by 100 for display.
 */
@Entity({ schema: 'public', name: 'shop_items' })
export class ShopItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Price in CENTS (BIGINT). 1000 = $10.00. */
  @Column({ type: 'bigint', name: 'price_cents' })
  priceCents: string;

  @Column({ type: 'text' })
  category: 'Merch' | 'Events' | 'Giving' | 'Books' | 'Media';

  @Column({ type: 'text', nullable: true })
  section: string | null;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'boolean', name: 'in_stock', default: true })
  inStock: boolean;

  @Column({ type: 'boolean', default: false })
  hot: boolean;

  /** Remaining inventory; NULL = unlimited / not tracked. */
  @Column({ type: 'int', nullable: true })
  stock: number | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
