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
import { CreateFundraiserDto } from './dto/create-fundraiser.dto';
import { UpdateFundraiserDto } from './dto/update-fundraiser.dto';
import { CreateDonationDto } from './dto/create-donation.dto';
import { Tenant } from '../tenants/entities/tenant.entity';
import { getTierFeatures } from '../common/config/tier-features.config';
import { NotificationType, NotificationJobData } from '../notifications/notifications.types';

@Injectable()
export class FundraisersService {
  private readonly logger = new Logger(FundraisersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
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
    const params: any[] = [userId, limit, offset];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`f.status = $${params.length}`);
    } else {
      conditions.push(`f.status = 'active'`);
    }

    if (category) {
      params.push(category);
      conditions.push(`f.category = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`f.title ILIKE $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const rows = await queryRunner.query(
      `SELECT f.*,
              t.name AS org_name,
              EXISTS(SELECT 1 FROM public.fundraiser_bookmarks WHERE fundraiser_id = f.id AND user_id = $1) AS is_bookmarked
       FROM public.fundraisers f
       JOIN public.tenants t ON t.id = f.tenant_id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    );

    const [{ total }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS total FROM public.fundraisers f ${where}`,
      params.slice(3), // skip userId, limit, offset — only filter params
    );

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

    return {
      ...this.mapFundraiserDetail(r),
      createdBy: {
        id: r.creator_id,
        fullName: r.creator_name,
        avatarUrl: r.creator_avatar,
      },
      recentBackers: recentBackers.map((b: any) => this.mapBacker(b)),
    };
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

    return {
      donationId: saved.id,
      clientSecret: paymentIntent.client_secret!,
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

  private mapFundraiserListItem(r: any) {
    const now = new Date();
    const endsAt = new Date(r.ends_at);
    const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      id: r.id,
      title: r.title,
      organization: r.org_name,
      category: r.category,
      targetAmount: Number(r.target_amount),
      raisedAmount: Number(r.raised_amount),
      backerCount: Number(r.backer_count),
      imageUrl: r.image_url,
      daysLeft,
      endsAt: r.ends_at,
      status: r.status,
      isBookmarked: r.is_bookmarked ?? false,
      createdAt: r.created_at,
    };
  }

  private mapFundraiserDetail(r: any) {
    const now = new Date();
    const endsAt = new Date(r.ends_at);
    const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      overview: r.overview,
      organization: r.org_name,
      category: r.category,
      targetAmount: Number(r.target_amount),
      raisedAmount: Number(r.raised_amount),
      currency: r.currency,
      backerCount: Number(r.backer_count),
      imageUrl: r.image_url,
      status: r.status,
      daysLeft,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      isBookmarked: r.is_bookmarked ?? false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
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
