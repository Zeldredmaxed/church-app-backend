import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StripeService } from '../stripe/stripe.service';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Transaction } from './entities/transaction.entity';
import { DonateDto } from './dto/donate.dto';
import { CreateFundDto } from './dto/create-fund.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { getTierFeatures } from '../common/config/tier-features.config';

@Injectable()
export class GivingService {
  private readonly logger = new Logger(GivingService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Initiates a donation to the current tenant's church.
   *
   * Flow:
   *   1. Verify the tenant has a Stripe Connect account with charges enabled
   *   2. Convert amount to cents (Stripe uses smallest currency unit)
   *   3. Calculate platform fee (1% application_fee_amount)
   *   4. Create a Stripe PaymentIntent with transfer_data.destination
   *   5. Save a 'pending' transaction record (RLS-scoped)
   *   6. Return the client_secret for the frontend to confirm the payment
   *
   * The frontend uses the client_secret with Stripe.js / Stripe Elements
   * to collect payment details and confirm the PaymentIntent.
   */
  async donate(
    dto: DonateDto,
    userId: string,
  ): Promise<{ clientSecret: string; transactionId: string }> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new BadRequestException('RLS context unavailable');
    }
    const { queryRunner, currentTenantId } = context;

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context');
    }

    // Step 1: Verify tenant has active Stripe account
    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    if (!tenant.stripeAccountId) {
      throw new BadRequestException(
        'This church has not set up payment processing. Please contact the church admin.',
      );
    }

    if (tenant.stripeAccountStatus !== 'active') {
      throw new BadRequestException(
        'This church\'s payment processing is not yet active. Status: ' + tenant.stripeAccountStatus,
      );
    }

    // Step 2: Convert to cents
    const amountCents = Math.round(dto.amount * 100);

    // Step 3: Calculate tier-aware platform fee
    const tierFeatures = getTierFeatures(tenant.tier);
    const platformFeeRate = tierFeatures.transactionFeePercent / 100;
    const platformFeeCents = Math.round(amountCents * platformFeeRate);

    // Step 4: Create Stripe PaymentIntent
    let paymentIntent;
    try {
      paymentIntent = await this.stripeService.createPaymentIntent(
        amountCents,
        dto.currency,
        tenant.stripeAccountId,
        platformFeeCents,
      );
    } catch (err: any) {
      this.logger.error(`Stripe PaymentIntent failed: ${err.message}`);
      throw new BadRequestException('Payment processing temporarily unavailable. Please try again.');
    }

    // Step 5: Save pending transaction (RLS INSERT policy enforces user_id = JWT sub)
    const transaction = queryRunner.manager.create(Transaction, {
      tenantId: currentTenantId,
      userId,
      amount: dto.amount,
      currency: dto.currency,
      stripePaymentIntentId: paymentIntent.id,
      status: 'pending',
    });

    const saved = await queryRunner.manager.save(Transaction, transaction);

    this.logger.log(
      `Donation initiated: ${dto.amount} ${dto.currency} from user ${userId} ` +
        `to tenant ${currentTenantId} (PI: ${paymentIntent.id})`,
    );

    // Step 6: Return client_secret for frontend confirmation
    if (!paymentIntent.client_secret) {
      throw new BadRequestException('Payment could not be initiated. Please try again.');
    }
    return {
      clientSecret: paymentIntent.client_secret,
      transactionId: saved.id,
    };
  }

  /**
   * Returns the authenticated user's donation history.
   * RLS SELECT policy: users can see their own transactions.
   */
  async getMyTransactions(
    cursor?: string,
    limit: number = 20,
  ): Promise<{ transactions: Transaction[]; nextCursor: string | null }> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new BadRequestException('RLS context unavailable');
    }
    const { queryRunner } = context;

    const qb = queryRunner.manager
      .createQueryBuilder(Transaction, 'tx')
      .orderBy('tx.created_at', 'DESC')
      .take(limit + 1);

    if (cursor) {
      const cursorTx = await queryRunner.manager.findOne(Transaction, {
        where: { id: cursor },
        select: ['createdAt'],
      });
      if (cursorTx) {
        qb.where('tx.created_at < :cursorDate', {
          cursorDate: cursorTx.createdAt,
        });
      }
    }

    const results = await qb.getMany();

    const hasMore = results.length > limit;
    const transactions = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? transactions[transactions.length - 1].id : null;

    return { transactions, nextCursor };
  }

  /**
   * Returns giving KPI metrics for the dashboard.
   * Uses service-role DataSource.
   */
  async getGivingKpis(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END), 0)::float AS total_giving,
        COALESCE(SUM(CASE WHEN status = 'succeeded' AND created_at >= date_trunc('month', now()) THEN amount ELSE 0 END), 0)::float AS this_month,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending_count,
        COUNT(DISTINCT user_id)::int AS unique_donors
       FROM public.transactions WHERE tenant_id = $1`,
      [tenantId],
    );

    const row = rows[0] ?? {};
    return {
      totalGiving: row.total_giving ?? 0,
      thisMonth: row.this_month ?? 0,
      pendingCount: row.pending_count ?? 0,
      uniqueDonors: row.unique_donors ?? 0,
    };
  }

  /**
   * Returns a list of unique donors for a tenant.
   * Uses service-role DataSource.
   */
  async getDonors(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT u.id, u.full_name, u.email, u.avatar_url
       FROM public.transactions t
       JOIN public.users u ON u.id = t.user_id
       WHERE t.tenant_id = $1 AND t.user_id IS NOT NULL
       ORDER BY u.full_name`,
      [tenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      avatarUrl: r.avatar_url,
    }));
  }

  /**
   * Returns active giving funds for a tenant.
   * Uses service-role DataSource.
   */
  async getFunds(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT id, tenant_id, name, description, is_active, created_at
       FROM public.giving_funds
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY name`,
      [tenantId],
    );

    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      isActive: r.is_active,
      createdAt: r.created_at,
    }));
  }

  /**
   * Creates a new giving fund for a tenant.
   * Uses service-role DataSource.
   */
  async createFund(tenantId: string, dto: CreateFundDto) {
    const rows = await this.dataSource.query(
      `INSERT INTO public.giving_funds (tenant_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, tenant_id, name, description, is_active, created_at`,
      [tenantId, dto.name, dto.description ?? null],
    );

    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      isActive: r.is_active,
      createdAt: r.created_at,
    };
  }

  /**
   * Returns all transactions for a specific tenant (admin dashboard).
   * RLS SELECT policy: tenant admins can see all tenant transactions.
   */
  async getTenantTransactions(
    tenantId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ transactions: Transaction[]; nextCursor: string | null }> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new BadRequestException('RLS context unavailable');
    }
    const { queryRunner } = context;

    const qb = queryRunner.manager
      .createQueryBuilder(Transaction, 'tx')
      .where('tx.tenant_id = :tenantId', { tenantId })
      .orderBy('tx.created_at', 'DESC')
      .take(limit + 1);

    if (cursor) {
      const cursorTx = await queryRunner.manager.findOne(Transaction, {
        where: { id: cursor },
        select: ['createdAt'],
      });
      if (cursorTx) {
        qb.andWhere('tx.created_at < :cursorDate', {
          cursorDate: cursorTx.createdAt,
        });
      }
    }

    const results = await qb.getMany();

    const hasMore = results.length > limit;
    const transactions = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? transactions[transactions.length - 1].id : null;

    return { transactions, nextCursor };
  }

  // ─── BATCH ENTRY (Cash/Check) ───

  /**
   * Record a batch of offline donations (cash/check envelopes).
   * Creates a batch header + individual transactions.
   */
  async createBatch(tenantId: string, userId: string, dto: CreateBatchDto) {
    const totalAmount = dto.items.reduce((sum, item) => sum + item.amount, 0);

    // Wrap in a transaction — if any item fails, the entire batch rolls back
    return this.dataSource.transaction(async manager => {
      // Create batch header
      const [batch] = await manager.query(
        `INSERT INTO public.giving_batches (tenant_id, created_by, name, total_amount, item_count, status, committed_at)
         VALUES ($1, $2, $3, $4, $5, 'committed', now())
         RETURNING *`,
        [tenantId, userId, dto.name ?? `Batch ${new Date().toLocaleDateString()}`, totalAmount, dto.items.length],
      );

      // Insert each donation as a transaction
      for (const item of dto.items) {
        const donationDate = item.date ? new Date(item.date) : new Date();
        await manager.query(
          `INSERT INTO public.transactions
            (tenant_id, user_id, amount, currency, stripe_payment_intent_id, status, payment_method, check_number, batch_id, notes, fund_id, created_at)
           VALUES ($1, $2, $3, 'usd', $4, 'succeeded', $5, $6, $7, $8, $9, $10)`,
          [
            tenantId,
            item.donorId ?? null,
            item.amount,
            `offline_${item.method}_${batch.id}_${Math.random().toString(36).substring(7)}`,
            item.method,
            item.checkNumber ?? null,
            batch.id,
            item.notes ?? null,
            item.fundId ?? null,
            donationDate.toISOString(),
          ],
        );
      }

      this.logger.log(`Batch created: ${batch.id} — ${dto.items.length} items, $${totalAmount}`);

      return {
        batchId: batch.id,
        name: batch.name,
        totalAmount,
        itemCount: dto.items.length,
        status: 'committed',
        createdAt: batch.created_at,
      };
    });
  }

  /**
   * List past batches for audit trail.
   */
  async getBatches(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT gb.*, u.full_name AS created_by_name
       FROM public.giving_batches gb
       JOIN public.users u ON u.id = gb.created_by
       WHERE gb.tenant_id = $1
       ORDER BY gb.created_at DESC`,
      [tenantId],
    );

    return {
      batches: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        totalAmount: Number(r.total_amount),
        itemCount: r.item_count,
        status: r.status,
        createdByName: r.created_by_name,
        committedAt: r.committed_at,
        createdAt: r.created_at,
      })),
    };
  }

  // ─── GIVING STATEMENTS ───

  /**
   * Generate a giving statement for a donor (for a specific year).
   * Returns structured data — the frontend renders/prints as PDF.
   */
  async getGivingStatement(tenantId: string, donorUserId: string, year: number) {
    // Run all 4 queries in parallel instead of sequentially
    const [tenantResult, donorResult, donations, fundraiserDonations] = await Promise.all([
      this.dataSource.query(`SELECT name FROM public.tenants WHERE id = $1`, [tenantId]),
      this.dataSource.query(`SELECT full_name, email FROM public.users WHERE id = $1`, [donorUserId]),
      this.dataSource.query(
        `SELECT t.amount, t.currency, t.payment_method, t.created_at,
                COALESCE(gf.name, 'General Fund') AS fund_name
         FROM public.transactions t
         LEFT JOIN public.giving_funds gf ON gf.id = t.fund_id
         WHERE t.tenant_id = $1 AND t.user_id = $2 AND t.status = 'succeeded'
           AND EXTRACT(year FROM t.created_at) = $3
         ORDER BY t.created_at ASC`,
        [tenantId, donorUserId, year],
      ),
      this.dataSource.query(
        `SELECT fd.amount, fd.created_at, f.title AS fundraiser_title, f.category
         FROM public.fundraiser_donations fd
         JOIN public.fundraisers f ON f.id = fd.fundraiser_id
         WHERE fd.tenant_id = $1 AND fd.donor_id = $2 AND fd.payment_status = 'succeeded'
           AND EXTRACT(year FROM fd.created_at) = $3
         ORDER BY fd.created_at ASC`,
        [tenantId, donorUserId, year],
      ),
    ]);

    const [tenant] = tenantResult;
    const [donor] = donorResult;
    if (!donor) throw new BadRequestException('Donor not found');

    const totalAmount = donations.reduce((sum: number, d: any) => sum + Number(d.amount), 0);

    // Group by fund
    const byFund: Record<string, number> = {};
    for (const d of donations) {
      byFund[d.fund_name] = (byFund[d.fund_name] ?? 0) + Number(d.amount);
    }

    const fundraiserTotal = fundraiserDonations.reduce(
      (sum: number, d: any) => sum + Number(d.amount), 0,
    );

    // Add fundraiser totals to byFund
    for (const fd of fundraiserDonations) {
      const label = `Fundraiser: ${fd.fundraiser_title}`;
      byFund[label] = (byFund[label] ?? 0) + Number(fd.amount);
    }

    const grandTotal = totalAmount + fundraiserTotal;

    return {
      churchName: tenant?.name ?? 'Church',
      year,
      donor: {
        fullName: donor.full_name,
        email: donor.email,
      },
      donations: donations.map((d: any) => ({
        date: d.created_at,
        amount: Number(d.amount),
        currency: d.currency,
        fundName: d.fund_name,
        method: d.payment_method,
      })),
      fundraiserDonations: fundraiserDonations.map((d: any) => ({
        date: d.created_at,
        amount: Number(d.amount),
        fundraiserTitle: d.fundraiser_title,
        category: d.category,
      })),
      totalAmount: grandTotal,
      givingTotal: totalAmount,
      fundraiserTotal,
      donationCount: donations.length + fundraiserDonations.length,
      byFund: Object.entries(byFund).map(([fund, total]) => ({ fund, total })),
      taxStatement: `No goods or services were provided in exchange for these contributions. ${tenant?.name ?? 'This church'} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Your contributions are tax-deductible to the extent allowed by law.`,
    };
  }
}
