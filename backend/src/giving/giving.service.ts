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
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amountCents,
      dto.currency,
      tenant.stripeAccountId,
      platformFeeCents,
    );

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
    return {
      clientSecret: paymentIntent.client_secret!,
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
}
