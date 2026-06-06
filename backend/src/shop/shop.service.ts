import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { StripeService } from '../stripe/stripe.service';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { getTierFeatures } from '../common/config/tier-features.config';
import { CreateShopItemDto } from './dto/create-shop-item.dto';
import { UpdateShopItemDto } from './dto/update-shop-item.dto';
import { PurchaseShopItemDto } from './dto/purchase-shop-item.dto';

type ShopCategory = 'Merch' | 'Events' | 'Giving' | 'Books' | 'Media';
const SHOP_CATEGORIES: ShopCategory[] = ['Merch', 'Events', 'Giving', 'Books', 'Media'];

interface ShopItemRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  price_cents: string;
  category: ShopCategory;
  section: string | null;
  image_url: string | null;
  in_stock: boolean;
  hot: boolean;
  stock: number | null;
  is_active: boolean;
  created_at: Date;
}

interface ShopOptionRow {
  id: string;
  item_id: string;
  label: string;
  price_delta_cents: string;
}

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  // ─── Public read ────────────────────────────────────────────────

  /**
   * Lists active shop items for the caller's tenant. Tenant scoping is
   * enforced by RLS on the queryRunner; no manual tenant_id filter needed.
   */
  async list(params: { category?: string; q?: string; limit: number; offset: number }) {
    const { queryRunner } = this.getRlsContext();
    const conds: string[] = [`is_active = true`];
    const args: any[] = [];

    if (params.category) {
      if (!SHOP_CATEGORIES.includes(params.category as ShopCategory)) {
        throw new BadRequestException(`Invalid category: ${params.category}`);
      }
      args.push(params.category);
      conds.push(`category = $${args.length}`);
    }
    if (params.q) {
      args.push(`%${params.q}%`);
      conds.push(`(title ILIKE $${args.length} OR description ILIKE $${args.length})`);
    }

    const where = conds.join(' AND ');

    const [{ total }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.shop_items WHERE ${where}`,
      args,
    );

    args.push(params.limit);
    const limitIdx = args.length;
    args.push(params.offset);
    const offsetIdx = args.length;

    const rows: ShopItemRow[] = await queryRunner.query(
      `SELECT id, tenant_id, title, description, price_cents, category, section,
              image_url, in_stock, hot, stock, is_active, created_at
       FROM public.shop_items
       WHERE ${where}
       ORDER BY hot DESC, created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      args,
    );

    return {
      data: rows.map((r) => this.mapItem(r)),
      total: Number(total),
      limit: params.limit,
      offset: params.offset,
    };
  }

  /**
   * Returns one item with its options. RLS limits visibility to the tenant.
   */
  async getOne(id: string) {
    const { queryRunner } = this.getRlsContext();
    const [row]: ShopItemRow[] = await queryRunner.query(
      `SELECT id, tenant_id, title, description, price_cents, category, section,
              image_url, in_stock, hot, stock, is_active, created_at
       FROM public.shop_items WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException('Shop item not found');

    const options: ShopOptionRow[] = await queryRunner.query(
      `SELECT id, item_id, label, price_delta_cents
       FROM public.shop_item_options WHERE item_id = $1 ORDER BY label ASC`,
      [id],
    );

    return {
      ...this.mapItem(row),
      stock: row.stock,
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        priceDeltaCents: Number(o.price_delta_cents),
      })),
    };
  }

  // ─── Admin CRUD ────────────────────────────────────────────────

  async create(dto: CreateShopItemDto, actorUserId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No tenant context');

    const [row]: ShopItemRow[] = await queryRunner.query(
      `INSERT INTO public.shop_items
         (tenant_id, title, description, price_cents, category, section,
          image_url, in_stock, hot, stock, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true),COALESCE($9,false),$10,true,$11)
       RETURNING id, tenant_id, title, description, price_cents, category, section,
                 image_url, in_stock, hot, stock, is_active, created_at`,
      [
        currentTenantId,
        dto.title,
        dto.description ?? null,
        dto.priceCents,
        dto.category,
        dto.section ?? null,
        dto.imageUrl ?? null,
        dto.inStock ?? true,
        dto.hot ?? false,
        dto.stock ?? null,
        actorUserId,
      ],
    );

    if (dto.options?.length) {
      await this.replaceOptions(row.id, dto.options);
    }

    await this.audit.log({
      action: 'shop.item_created',
      resourceType: 'shop_item',
      resourceId: row.id,
      summary: `Admin created shop item "${row.title}"`,
      metadata: {
        title: row.title,
        category: row.category,
        priceCents: Number(row.price_cents),
      },
    });

    return this.getOne(row.id);
  }

  async update(id: string, dto: UpdateShopItemDto) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No tenant context');

    // Ensure the item exists in the caller's tenant. RLS will already hide
    // foreign-tenant rows, but the explicit check gives a clean 404.
    const [existing]: ShopItemRow[] = await queryRunner.query(
      `SELECT id, tenant_id, title FROM public.shop_items WHERE id = $1`,
      [id],
    );
    if (!existing) throw new NotFoundException('Shop item not found');
    if (existing.tenant_id !== currentTenantId) {
      throw new ForbiddenException('Cannot edit an item from another tenant');
    }

    const sets: string[] = [];
    const args: any[] = [];
    const push = (col: string, val: unknown) => {
      args.push(val);
      sets.push(`${col} = $${args.length}`);
    };

    if (dto.title !== undefined) push('title', dto.title);
    if (dto.description !== undefined) push('description', dto.description ?? null);
    if (dto.priceCents !== undefined) push('price_cents', dto.priceCents);
    if (dto.category !== undefined) push('category', dto.category);
    if (dto.section !== undefined) push('section', dto.section ?? null);
    if (dto.imageUrl !== undefined) push('image_url', dto.imageUrl ?? null);
    if (dto.inStock !== undefined) push('in_stock', dto.inStock);
    if (dto.hot !== undefined) push('hot', dto.hot);
    if (dto.stock !== undefined) push('stock', dto.stock ?? null);

    if (sets.length) {
      sets.push(`updated_at = now()`);
      args.push(id);
      await queryRunner.query(
        `UPDATE public.shop_items SET ${sets.join(', ')} WHERE id = $${args.length}`,
        args,
      );
    }

    if (dto.options !== undefined) {
      await this.replaceOptions(id, dto.options);
    }

    await this.audit.log({
      action: 'shop.item_updated',
      resourceType: 'shop_item',
      resourceId: id,
      summary: `Admin updated shop item "${existing.title}"`,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.getOne(id);
  }

  async remove(id: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No tenant context');

    const [existing]: ShopItemRow[] = await queryRunner.query(
      `SELECT id, tenant_id, title FROM public.shop_items WHERE id = $1`,
      [id],
    );
    if (!existing) throw new NotFoundException('Shop item not found');
    if (existing.tenant_id !== currentTenantId) {
      throw new ForbiddenException('Cannot delete an item from another tenant');
    }

    // Soft-delete: flipping is_active preserves order history (shop_orders
    // has ON DELETE RESTRICT on item_id, so a hard delete would fail once
    // any order exists for this item).
    await queryRunner.query(
      `UPDATE public.shop_items SET is_active = false, updated_at = now() WHERE id = $1`,
      [id],
    );

    await this.audit.log({
      action: 'shop.item_deleted',
      resourceType: 'shop_item',
      resourceId: id,
      summary: `Admin removed shop item "${existing.title}"`,
      metadata: { soft: true },
    });

    return { id, deleted: true };
  }

  // ─── Purchase ──────────────────────────────────────────────────

  async purchase(itemId: string, dto: PurchaseShopItemDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No tenant context');

    // Tenant Stripe Connect readiness — mirror the giving flow.
    const tenant = await queryRunner.manager.findOne(Tenant, { where: { id: currentTenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    if (!tenant.stripeAccountId) {
      throw new BadRequestException(
        'This church has not set up payment processing. Please contact the church admin.',
      );
    }
    if (tenant.stripeAccountStatus !== 'active') {
      throw new BadRequestException(
        `This church's payment processing is not yet active. Status: ${tenant.stripeAccountStatus}`,
      );
    }

    // Pull item + options inside the RLS context so we don't quote a price
    // from a foreign-tenant item.
    const [item]: ShopItemRow[] = await queryRunner.query(
      `SELECT id, tenant_id, title, price_cents, in_stock, stock, is_active, category
       FROM public.shop_items WHERE id = $1`,
      [itemId],
    );
    if (!item || !item.is_active) throw new NotFoundException('Shop item not found');
    if (!item.in_stock) throw new BadRequestException('Item is out of stock');

    // Atomic stock reserve BEFORE charging. Conditional UPDATE returns
    // rowCount=0 if another concurrent buyer just took the last unit,
    // in which case we refuse to charge. The webhook (C2) finalizes
    // pending PIs; if a PI fails / 3DS-fails, see the compensating
    // restock at the end of this method.
    if (item.stock !== null) {
      const reserved = await queryRunner.query(
        `UPDATE public.shop_items
         SET stock = stock - $2,
             in_stock = CASE WHEN stock - $2 <= 0 THEN false ELSE in_stock END,
             updated_at = now()
         WHERE id = $1 AND stock >= $2
         RETURNING stock`,
        [itemId, dto.quantity],
      );
      if (reserved.length === 0) {
        throw new BadRequestException('Out of stock — only some units remain');
      }
    }

    let optionDeltaCents = 0;
    const optionIds: string[] = Array.isArray(dto.optionIds) ? dto.optionIds : [];
    if (optionIds.length) {
      const opts: ShopOptionRow[] = await queryRunner.query(
        `SELECT id, item_id, label, price_delta_cents
         FROM public.shop_item_options
         WHERE item_id = $1 AND id = ANY($2::uuid[])`,
        [itemId, optionIds],
      );
      if (opts.length !== optionIds.length) {
        throw new BadRequestException('One or more selected options do not belong to this item');
      }
      optionDeltaCents = opts.reduce((sum, o) => sum + Number(o.price_delta_cents), 0);
    }

    const unitPriceCents = Number(item.price_cents) + optionDeltaCents;
    const totalCents = unitPriceCents * dto.quantity;
    if (totalCents <= 0) {
      throw new BadRequestException('Order total must be positive');
    }

    // Resolve / lazily create the buyer's Stripe Customer. Mirror the
    // recurring-giving pattern: SELECT … FOR UPDATE to avoid creating two
    // Customers under a double-tap.
    const customerId: string = await this.dataSource.transaction(async (tx) => {
      const [row] = await tx.query(
        `SELECT email, full_name, stripe_customer_id
         FROM public.users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!row) throw new BadRequestException('User not found');
      if (row.stripe_customer_id) return row.stripe_customer_id;
      const customer = await this.stripe.createCustomer(row.email, row.full_name ?? undefined);
      await tx.query(
        `UPDATE public.users SET stripe_customer_id = $1 WHERE id = $2`,
        [customer.id, userId],
      );
      return customer.id;
    });

    // Attach the PM to the customer if it isn't already (mirrors recurring-giving).
    const pm = await this.stripe.retrievePaymentMethod(dto.paymentMethodId);
    if (pm.customer && pm.customer !== customerId) {
      throw new BadRequestException('paymentMethodId belongs to a different customer');
    }
    if (!pm.customer) {
      await this.stripe.attachPaymentMethod(dto.paymentMethodId, customerId);
    }

    const tierFeatures = getTierFeatures(tenant.tier);
    const platformFeeCents = Math.round(totalCents * (tierFeatures.transactionFeePercent / 100));

    // Stripe idempotency key — (user, item, options-fingerprint, quantity,
    // minute-bucket). A mobile retry within the same minute returns the same
    // PI, so we never double-charge.
    const sortedOptionFingerprint = [...optionIds].sort().join(',');
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = [
      'shop', userId, itemId, dto.quantity, sortedOptionFingerprint, minuteBucket,
    ].join(':');

    let paymentIntent;
    try {
      paymentIntent = await this.stripe.createAndConfirmPaymentIntent({
        amountCents: totalCents,
        currency: 'usd',
        customerId,
        paymentMethodId: dto.paymentMethodId,
        destinationAccountId: tenant.stripeAccountId,
        platformFeeCents,
        metadata: {
          tenantId: currentTenantId,
          userId,
          shopItemId: itemId,
          quantity: String(dto.quantity),
        },
        idempotencyKey,
      });
    } catch (err: any) {
      this.logger.error(`Shop PaymentIntent failed for item ${itemId}: ${err.message}`);
      // Compensating restock — we reserved before charging, so a charge
      // failure means we owe the stock back.
      if (item.stock !== null) {
        await queryRunner.query(
          `UPDATE public.shop_items
           SET stock = stock + $2, in_stock = true, updated_at = now()
           WHERE id = $1`,
          [itemId, dto.quantity],
        );
      }
      throw new BadRequestException(err.message ?? 'Payment failed');
    }

    // Decide initial DB status from the PI state. Webhooks will flip
    // pending → paid / failed as Stripe settles.
    const status: 'pending' | 'paid' | 'failed' =
      paymentIntent.status === 'succeeded'
        ? 'paid'
        : paymentIntent.status === 'requires_action' ||
            paymentIntent.status === 'requires_confirmation' ||
            paymentIntent.status === 'processing'
          ? 'pending'
          : 'failed';

    const [orderRow] = await queryRunner.query(
      `INSERT INTO public.shop_orders
         (tenant_id, user_id, item_id, quantity, option_ids, total_cents,
          stripe_payment_intent_id, status)
       VALUES ($1,$2,$3,$4,$5::uuid[],$6,$7,$8)
       RETURNING id, tenant_id, user_id, item_id, quantity, option_ids,
                 total_cents, stripe_payment_intent_id, status, created_at`,
      [
        currentTenantId,
        userId,
        itemId,
        dto.quantity,
        optionIds,
        totalCents,
        paymentIntent.id,
        status,
      ],
    );

    // Stock was reserved at line 308 before charging. Webhook
    // (stripe-webhook.controller payment_intent.succeeded handler)
    // flips status pending → paid as Stripe settles. We don't decrement
    // again here. payment_intent.payment_failed flips status to 'failed'
    // — TODO: also restock there for the async-failure case. For now
    // the catch above handles the synchronous-failure path.

    await this.audit.log({
      action: 'shop.purchase',
      resourceType: 'shop_order',
      resourceId: orderRow.id,
      summary: `Purchased "${item.title}" × ${dto.quantity} for $${(totalCents / 100).toFixed(2)}`,
      metadata: {
        itemId,
        quantity: dto.quantity,
        totalCents,
        paymentIntentId: paymentIntent.id,
        status,
      },
    });

    return {
      order: {
        id: orderRow.id,
        tenantId: orderRow.tenant_id,
        userId: orderRow.user_id,
        itemId: orderRow.item_id,
        quantity: orderRow.quantity,
        optionIds: orderRow.option_ids ?? [],
        totalCents: Number(orderRow.total_cents),
        stripePaymentIntentId: orderRow.stripe_payment_intent_id,
        status: orderRow.status,
        createdAt: orderRow.created_at,
        clientSecret: paymentIntent.client_secret ?? null,
        nextAction: paymentIntent.next_action ?? null,
      },
    };
  }

  // ─── helpers ───────────────────────────────────────────────────

  /**
   * Wipes and re-inserts the option set for an item. Called from create
   * (when options provided) and update (when options is explicitly in the
   * DTO). The DELETE first ensures we don't have to diff label-by-label.
   */
  private async replaceOptions(
    itemId: string,
    options: Array<{ label: string; priceDeltaCents?: number }>,
  ): Promise<void> {
    const { queryRunner } = this.getRlsContext();
    await queryRunner.query(
      `DELETE FROM public.shop_item_options WHERE item_id = $1`,
      [itemId],
    );
    if (!options.length) return;

    // Build a multi-row VALUES insert; param count grows with the option
    // list. Each option contributes (item_id, label, price_delta_cents).
    const valueParts: string[] = [];
    const args: any[] = [];
    for (const opt of options) {
      args.push(itemId, opt.label, opt.priceDeltaCents ?? 0);
      const base = args.length - 3;
      valueParts.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    }
    await queryRunner.query(
      `INSERT INTO public.shop_item_options (item_id, label, price_delta_cents)
       VALUES ${valueParts.join(', ')}`,
      args,
    );
  }

  private mapItem(r: ShopItemRow) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      description: r.description,
      price: Number(r.price_cents),
      category: r.category,
      section: r.section,
      imageUrl: r.image_url,
      inStock: r.in_stock,
      hot: r.hot,
      createdAt: r.created_at,
    };
  }

}
