import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { rlsStorage } from '../common/storage/rls.storage';
import { StripeService } from '../stripe/stripe.service';
import { Fundraiser } from './entities/fundraiser.entity';
import { FundraiserDonation } from './entities/fundraiser-donation.entity';
import { FundraiserBookmark } from './entities/fundraiser-bookmark.entity';
import { FundraiserUpdate } from './entities/fundraiser-update.entity';
import { CreateFundraiserDto } from './dto/create-fundraiser.dto';
import { UpdateFundraiserDto } from './dto/update-fundraiser.dto';
import { CreateDonationDto } from './dto/create-donation.dto';
import { CreateFundraiserUpdateDto } from './dto/create-fundraiser-update.dto';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { getTierFeatures } from '../common/config/tier-features.config';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';

@Injectable()
export class FundraisersService {
  private readonly logger = new Logger(FundraisersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly auditService: AuditService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {}

  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  // ── List Fundraisers ──

  async listFundraisers(
    userId: string,
    category?: string,
    status?: string,
    search?: string,
    page = 1,
    limit = 20,
  ) {
    const { queryRunner } = this.getRlsContext();
    const offset = (page - 1) * limit;

    // Build filter conditions with separate param arrays for main query vs count query
    const filterParams: any[] = [];
    const conditions: string[] = [];
    // For the main query, $1=userId, $2=limit, $3=offset, filters start at $4
    // For the count query, filters start at $1
    const mainConditions: string[] = [];
    const countConditions: string[] = [];

    if (status) {
      filterParams.push(status);
      mainConditions.push(`f.status = $${3 + filterParams.length}`);
      countConditions.push(`f.status = $${filterParams.length}`);
    } else {
      mainConditions.push(`f.status = 'active'`);
      countConditions.push(`f.status = 'active'`);
    }

    if (category) {
      filterParams.push(category);
      mainConditions.push(`f.category = $${3 + filterParams.length}`);
      countConditions.push(`f.category = $${filterParams.length}`);
    }

    if (search && search.trim()) {
      filterParams.push(`%${search.trim()}%`);
      mainConditions.push(`f.title ILIKE $${3 + filterParams.length}`);
      countConditions.push(`f.title ILIKE $${filterParams.length}`);
    }

    const mainWhere = mainConditions.length ? 'WHERE ' + mainConditions.join(' AND ') : '';
    const countWhere = countConditions.length ? 'WHERE ' + countConditions.join(' AND ') : '';

    const rows = await queryRunner.query(
      `SELECT f.*,
              t.name AS org_name,
              EXISTS(SELECT 1 FROM public.fundraiser_bookmarks WHERE fundraiser_id = f.id AND user_id = $1) AS is_bookmarked
       FROM public.fundraisers f
       JOIN public.tenants t ON t.id = f.tenant_id
       ${mainWhere}
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset, ...filterParams],
    );

    const countResult = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.fundraisers f ${countWhere}`,
      filterParams,
    );
    const total = countResult[0]?.total ?? 0;

    return {
      data: rows.map((r: any) => this.mapFundraiserListItem(r)),
      total: Number(total),
      page,
    };
  }

  // ── Get Fundraiser Detail ──

  async getFundraiser(id: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    const rows = await queryRunner.query(
      `SELECT f.*,
              t.name AS org_name,
              u.id AS creator_id, u.full_name AS creator_name, u.avatar_url AS creator_avatar,
              EXISTS(SELECT 1 FROM public.fundraiser_bookmarks WHERE fundraiser_id = f.id AND user_id = $2) AS is_bookmarked
       FROM public.fundraisers f
       JOIN public.tenants t ON t.id = f.tenant_id
       LEFT JOIN public.users u ON u.id = f.created_by
       WHERE f.id = $1`,
      [id, userId],
    );

    if (!rows.length) throw new NotFoundException('Fundraiser not found');
    const r = rows[0];

    // Get recent backers (last 10 succeeded donations)
    const recentBackers = await queryRunner.query(
      `SELECT fd.id, fd.amount, fd.message, fd.anonymous, fd.created_at,
              u.id AS donor_id, u.full_name AS donor_name, u.avatar_url AS donor_avatar
       FROM public.fundraiser_donations fd
       LEFT JOIN public.users u ON u.id = fd.donor_id
       WHERE fd.fundraiser_id = $1 AND fd.payment_status = 'succeeded'
       ORDER BY fd.created_at DESC
       LIMIT 10`,
      [id],
    );

    // Recent updates (most recent 20)
    const updates = await queryRunner.query(
      `SELECT fu.id, fu.content, fu.created_at, fu.posted_by,
              u.full_name AS author_name, u.avatar_url AS author_avatar
       FROM public.fundraiser_updates fu
       LEFT JOIN public.users u ON u.id = fu.posted_by
       WHERE fu.fundraiser_id = $1
       ORDER BY fu.created_at DESC
       LIMIT 20`,
      [id],
    );

    return {
      ...this.mapFundraiserDetail(r),
      createdBy: {
        id: r.creator_id,
        fullName: r.creator_name,
        avatarUrl: r.creator_avatar,
      },
      backers: recentBackers.map((b: any) => this.mapBacker(b)),
      recentBackers: recentBackers.map((b: any) => this.mapBacker(b)),
      updates: updates.map((u: any) => this.mapUpdate(u)),
    };
  }

  // ── Delete Fundraiser (Admin, soft-delete via status='cancelled') ──

  async deleteFundraiser(id: string, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No active tenant context.');

    await this.verifyPremiumTier(currentTenantId);

    const existing = await queryRunner.manager.findOne(Fundraiser, { where: { id } });
    if (!existing) throw new NotFoundException('Fundraiser not found');

    if (existing.status === 'cancelled') {
      return { id, status: 'cancelled' };
    }

    await queryRunner.manager.update(
      Fundraiser,
      { id },
      { status: 'cancelled' },
    );

    await this.auditService.log({
      action: 'fundraiser.cancelled',
      resourceType: 'fund',
      resourceId: id,
      summary: `Cancelled fundraiser "${existing.title}"`,
      metadata: { fundraiserId: id, previousStatus: existing.status },
    });

    this.logger.log(`Fundraiser ${id} cancelled by ${userId}`);
    return { id, status: 'cancelled' };
  }

  // ── Close Fundraiser (Admin) — mark as completed ──

  async closeFundraiser(id: string, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No active tenant context.');

    await this.verifyPremiumTier(currentTenantId);

    const existing = await queryRunner.manager.findOne(Fundraiser, { where: { id } });
    if (!existing) throw new NotFoundException('Fundraiser not found');

    if (existing.status === 'completed') {
      return { id, status: 'completed' };
    }
    if (existing.status === 'cancelled') {
      throw new BadRequestException('Cancelled fundraisers cannot be closed.');
    }

    await queryRunner.manager.update(
      Fundraiser,
      { id },
      { status: 'completed' },
    );

    await this.auditService.log({
      action: 'fundraiser.closed',
      resourceType: 'fund',
      resourceId: id,
      summary: `Closed fundraiser "${existing.title}"`,
      metadata: { fundraiserId: id, previousStatus: existing.status },
    });

    this.logger.log(`Fundraiser ${id} closed by ${userId}`);
    return { id, status: 'completed' };
  }

  // ── Fundraiser Updates ──

  async listUpdates(fundraiserId: string, page = 1, limit = 20) {
    const { queryRunner } = this.getRlsContext();
    const offset = (page - 1) * limit;

    // Confirm fundraiser visible to the caller via RLS.
    const fr = await queryRunner.manager.findOne(Fundraiser, { where: { id: fundraiserId } });
    if (!fr) throw new NotFoundException('Fundraiser not found');

    const rows = await queryRunner.query(
      `SELECT fu.id, fu.content, fu.created_at, fu.posted_by,
              u.full_name AS author_name, u.avatar_url AS author_avatar
       FROM public.fundraiser_updates fu
       LEFT JOIN public.users u ON u.id = fu.posted_by
       WHERE fu.fundraiser_id = $1
       ORDER BY fu.created_at DESC
       LIMIT $2 OFFSET $3`,
      [fundraiserId, limit, offset],
    );

    const [{ total }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.fundraiser_updates WHERE fundraiser_id = $1`,
      [fundraiserId],
    );

    return {
      data: rows.map((u: any) => this.mapUpdate(u)),
      total: Number(total),
      page,
    };
  }

  async createUpdate(
    fundraiserId: string,
    dto: CreateFundraiserUpdateDto,
    userId: string,
  ) {
    const { queryRunner, currentTenantId } = this.getRlsContext();
    if (!currentTenantId) throw new BadRequestException('No active tenant context.');

    const fundraiser = await queryRunner.manager.findOne(Fundraiser, { where: { id: fundraiserId } });
    if (!fundraiser) throw new NotFoundException('Fundraiser not found');

    const isAuthor = fundraiser.createdBy === userId;
    let isAdmin = false;
    if (!isAuthor) {
      const membership = await this.dataSource.query(
        `SELECT role FROM public.tenant_memberships WHERE user_id = $1 AND tenant_id = $2`,
        [userId, currentTenantId],
      );
      isAdmin = membership[0]?.role === 'admin' || membership[0]?.role === 'pastor';
    }
    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('Only the fundraiser creator or an admin can post updates.');
    }

    const update = queryRunner.manager.create(FundraiserUpdate, {
      fundraiserId,
      tenantId: currentTenantId,
      postedBy: userId,
      content: dto.content,
    });
    const saved = await queryRunner.manager.save(FundraiserUpdate, update);

    await this.auditService.log({
      action: 'fundraiser.update_posted',
      resourceType: 'fund',
      resourceId: fundraiserId,
      summary: `Posted update on "${fundraiser.title}"`,
      metadata: { updateId: saved.id },
    });

    return this.mapUpdate({
      id: saved.id,
      content: saved.content,
      created_at: saved.createdAt,
      posted_by: saved.postedBy,
      author_name: null,
      author_avatar: null,
    });
  }

  // ── Get Backers ──

  async getBackers(fundraiserId: string, page = 1, limit = 50) {
    const { queryRunner } = this.getRlsContext();
    const offset = (page - 1) * limit;

    const rows = await queryRunner.query(
      `SELECT fd.id, fd.amount, fd.message, fd.anonymous, fd.created_at,
              u.id AS donor_id, u.full_name AS donor_name, u.avatar_url AS donor_avatar
       FROM public.fundraiser_donations fd
       LEFT JOIN public.users u ON u.id = fd.donor_id
       WHERE fd.fundraiser_id = $1 AND fd.payment_status = 'succeeded'
       ORDER BY fd.created_at DESC
       LIMIT $2 OFFSET $3`,
      [fundraiserId, limit, offset],
    );

    const [{ total }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.fundraiser_donations
       WHERE fundraiser_id = $1 AND payment_status = 'succeeded'`,
      [fundraiserId],
    );

    return {
      data: rows.map((b: any) => this.mapBacker(b)),
      total: Number(total),
      page,
    };
  }

  // ── Create Donation (Stripe) ──

  async createDonation(fundraiserId: string, dto: CreateDonationDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }

    // Verify fundraiser exists, is active, and not expired
    const fundraiser = await queryRunner.manager.findOne(Fundraiser, {
      where: { id: fundraiserId },
    });
    if (!fundraiser) throw new NotFoundException('Fundraiser not found');
    if (fundraiser.status !== 'active') {
      throw new BadRequestException('This fundraiser is not currently accepting donations.');
    }
    if (new Date(fundraiser.endsAt) < new Date()) {
      throw new BadRequestException('This fundraiser has ended.');
    }

    // Get tenant for Stripe account
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });
    if (!tenant?.stripeAccountId || tenant.stripeAccountStatus !== 'active') {
      throw new BadRequestException('This church has not set up payment processing.');
    }

    // Calculate platform fee
    const tierFeatures = getTierFeatures(tenant.tier);
    const platformFeeRate = tierFeatures.transactionFeePercent / 100;
    const platformFeeCents = Math.round(dto.amount * platformFeeRate);

    // Idempotency: if the same donor has an unconfirmed pending donation
    // to this fundraiser for the same amount in the last 30 min, reuse
    // its PaymentIntent. Without this, a mobile retry of POST /donate
    // creates a second pending row; the webhook then double-credits the
    // fundraiser when both rows flip to 'succeeded'. UNIQUE constraint
    // on payment_intent_id (migration 073) is the DB-level backstop;
    // this is the friendly reuse path.
    const existingPending = await queryRunner.query(
      `SELECT id, payment_intent_id
       FROM public.fundraiser_donations
       WHERE fundraiser_id = $1 AND donor_id = $2 AND amount = $3
         AND payment_status = 'pending'
         AND created_at > now() - interval '30 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [fundraiserId, userId, dto.amount],
    );
    if (existingPending.length > 0) {
      const existing = existingPending[0];
      try {
        const pi = await this.stripeService.retrievePaymentIntent(existing.payment_intent_id);
        if (pi.client_secret && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
          this.logger.log(
            `Reusing pending fundraiser donation ${existing.id} (PI ${existing.payment_intent_id}) for ${userId}`,
          );
          return {
            donationId: existing.id,
            clientSecret: pi.client_secret,
            status: 'requires_confirmation',
          };
        }
      } catch (err: any) {
        // PI not retrievable (deleted, expired) — fall through to create a new one.
        this.logger.warn(`Could not retrieve existing PI ${existing.payment_intent_id}: ${err.message}`);
      }
    }

    // Create Stripe PaymentIntent
    let paymentIntent;
    try {
      paymentIntent = await this.stripeService.createPaymentIntent(
        dto.amount,
        fundraiser.currency.toLowerCase(),
        tenant.stripeAccountId,
        platformFeeCents,
      );
    } catch (err: any) {
      this.logger.error(`Stripe PaymentIntent failed for fundraiser ${fundraiserId}: ${err.message}`);
      throw new BadRequestException('Payment processing temporarily unavailable. Please try again.');
    }

    // Save pending donation
    const donation = queryRunner.manager.create(FundraiserDonation, {
      fundraiserId,
      donorId: userId,
      tenantId: currentTenantId,
      amount: dto.amount,
      message: dto.message ?? null,
      paymentIntentId: paymentIntent.id,
      paymentStatus: 'pending',
      anonymous: dto.anonymous ?? false,
    });
    const saved = await queryRunner.manager.save(FundraiserDonation, donation);

    this.logger.log(
      `Fundraiser donation initiated: ${dto.amount}c from ${userId} to fundraiser ${fundraiserId} (PI: ${paymentIntent.id})`,
    );

    if (!paymentIntent.client_secret) {
      throw new BadRequestException('Payment could not be initiated. Please try again.');
    }
    return {
      donationId: saved.id,
      clientSecret: paymentIntent.client_secret,
      status: 'requires_confirmation',
    };
  }

  // ── Create Fundraiser (Admin) ──

  async createFundraiser(dto: CreateFundraiserDto, userId: string) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }

    // Verify premium+ tier
    await this.verifyPremiumTier(currentTenantId);

    // Validate deadline is in the future
    if (new Date(dto.endsAt) <= new Date()) {
      throw new BadRequestException('Fundraiser deadline must be in the future.');
    }

    const fundraiser = queryRunner.manager.create(Fundraiser, {
      tenantId: currentTenantId,
      createdBy: userId,
      title: dto.title,
      overview: dto.overview,
      category: dto.category,
      targetAmount: dto.targetAmount,
      currency: 'USD',
      imageUrl: dto.imageUrl ?? null,
      icon: dto.icon ?? null,
      status: dto.status ?? 'active',
      startsAt: new Date(),
      endsAt: new Date(dto.endsAt),
    });

    const saved = await queryRunner.manager.save(Fundraiser, fundraiser);
    this.logger.log(`Fundraiser created: ${saved.id} "${saved.title}" by ${userId}`);
    return saved;
  }

  // ── Update Fundraiser (Admin) ──

  async updateFundraiser(id: string, dto: UpdateFundraiserDto) {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context.');
    }

    await this.verifyPremiumTier(currentTenantId);

    const updates: Partial<Fundraiser> = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.overview !== undefined) updates.overview = dto.overview;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.targetAmount !== undefined) updates.targetAmount = dto.targetAmount;
    if (dto.imageUrl !== undefined) updates.imageUrl = dto.imageUrl;
    if (dto.icon !== undefined) updates.icon = dto.icon;
    if (dto.status !== undefined) updates.status = dto.status as Fundraiser['status'];
    if (dto.endsAt !== undefined) {
      if (new Date(dto.endsAt) <= new Date()) {
        throw new BadRequestException('Fundraiser deadline must be in the future.');
      }
      updates.endsAt = new Date(dto.endsAt);
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No fields to update.');
    }

    const result = await queryRunner.manager.update(Fundraiser, { id }, updates);
    if (result.affected === 0) throw new NotFoundException('Fundraiser not found');

    return queryRunner.manager.findOneOrFail(Fundraiser, { where: { id } });
  }

  // ── Toggle Bookmark ──

  async toggleBookmark(fundraiserId: string, userId: string) {
    const { queryRunner } = this.getRlsContext();

    // Check if already bookmarked
    const existing = await queryRunner.query(
      `SELECT id FROM public.fundraiser_bookmarks WHERE fundraiser_id = $1 AND user_id = $2`,
      [fundraiserId, userId],
    );

    if (existing.length > 0) {
      await queryRunner.query(
        `DELETE FROM public.fundraiser_bookmarks WHERE fundraiser_id = $1 AND user_id = $2`,
        [fundraiserId, userId],
      );
      return { bookmarked: false };
    }

    await queryRunner.query(
      `INSERT INTO public.fundraiser_bookmarks (fundraiser_id, user_id) VALUES ($1, $2)
       ON CONFLICT (fundraiser_id, user_id) DO NOTHING`,
      [fundraiserId, userId],
    );
    return { bookmarked: true };
  }

  // ── Helpers ──

  private async verifyPremiumTier(tenantId: string) {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
      select: ['id', 'tier'],
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (tenant.tier === 'standard') {
      throw new ForbiddenException('Fundraisers require a Premium or Enterprise plan.');
    }
  }

  /** Days left until ends_at; null once ended. Rounds up so a 12hr remainder still reads as "1 day". */
  private computeDaysLeft(endsAt: Date | string): number | null {
    const end = new Date(endsAt).getTime();
    const now = Date.now();
    if (end <= now) return null;
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  }

  private isClosed(status: string): boolean {
    return status === 'completed' || status === 'cancelled';
  }

  private mapFundraiserListItem(r: any) {
    const targetCents = Number(r.target_amount);
    const raisedCents = Number(r.raised_amount);
    const daysLeft = this.computeDaysLeft(r.ends_at);

    return {
      id: r.id,
      title: r.title,
      organization: r.org_name,
      category: r.category,
      // Both shapes shipped — legacy callers read cents, mobile reads dollars.
      targetAmount: targetCents,
      raisedAmount: raisedCents,
      targetCents,
      raisedCents,
      target: targetCents / 100,
      raised: raisedCents / 100,
      targetDollars: targetCents / 100,
      raisedDollars: raisedCents / 100,
      backerCount: Number(r.backer_count),
      imageUrl: r.image_url,
      coverImageUrl: r.image_url,
      icon: r.icon ?? null,
      daysLeft,
      endsAt: r.ends_at,
      status: r.status,
      isClosed: this.isClosed(r.status),
      isBookmarked: r.is_bookmarked ?? false,
      createdAt: r.created_at,
    };
  }

  private mapFundraiserDetail(r: any) {
    const targetCents = Number(r.target_amount);
    const raisedCents = Number(r.raised_amount);
    const daysLeft = this.computeDaysLeft(r.ends_at);

    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      overview: r.overview,
      organization: r.org_name,
      category: r.category,
      targetAmount: targetCents,
      raisedAmount: raisedCents,
      targetCents,
      raisedCents,
      target: targetCents / 100,
      raised: raisedCents / 100,
      targetDollars: targetCents / 100,
      raisedDollars: raisedCents / 100,
      currency: r.currency,
      backerCount: Number(r.backer_count),
      imageUrl: r.image_url,
      coverImageUrl: r.image_url,
      icon: r.icon ?? null,
      status: r.status,
      isClosed: this.isClosed(r.status),
      daysLeft,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      isBookmarked: r.is_bookmarked ?? false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapUpdate(u: any) {
    return {
      id: u.id,
      content: u.content,
      createdAt: u.created_at,
      postedBy: {
        id: u.posted_by,
        fullName: u.author_name,
        avatarUrl: u.author_avatar,
      },
    };
  }

  private mapBacker(b: any) {
    return {
      id: b.id,
      donor: b.anonymous
        ? { id: null, fullName: 'Anonymous', avatarUrl: null }
        : { id: b.donor_id, fullName: b.donor_name, avatarUrl: b.donor_avatar },
      amount: Number(b.amount),
      message: b.message,
      anonymous: b.anonymous,
      createdAt: b.created_at,
    };
  }
}
