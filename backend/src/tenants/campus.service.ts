import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { User } from '../users/entities/user.entity';
import { getTierFeatures } from '../common/config/tier-features.config';

export interface CreateCampusDto {
  campusName: string;
  name?: string;        // Full legal name (defaults to "OrgName - CampusName")
  slug?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateCampusDto {
  campusName?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  feedIsolation?: boolean;
}

@Injectable()
export class CampusService {
  private readonly logger = new Logger(CampusService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolve the parent org tenant ID from any tenant in the org.
   * If the tenant has a parent_tenant_id, return that. Otherwise, return its own ID.
   */
  private async resolveParentId(tenantId: string): Promise<string> {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
      select: ['id', 'parentTenantId'],
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant.parentTenantId ?? tenant.id;
  }

  /**
   * Verify the calling tenant has multi-site enabled (enterprise tier).
   */
  private async verifyMultiSiteEnabled(tenantId: string): Promise<Tenant> {
    const parentId = await this.resolveParentId(tenantId);
    const parent = await this.dataSource.manager.findOne(Tenant, {
      where: { id: parentId },
    });
    if (!parent) throw new NotFoundException('Organization not found');

    const features = getTierFeatures(parent.tier);
    if (!features.multiSite) {
      throw new ForbiddenException(
        'Multi-site requires the Enterprise plan. Your organization is on the ' +
        parent.tier.charAt(0).toUpperCase() + parent.tier.slice(1) + ' plan.',
      );
    }
    return parent;
  }

  /**
   * Create a new campus under a parent organization.
   * The parent tenant becomes the "organization" tenant.
   */
  async createCampus(
    parentTenantId: string,
    dto: CreateCampusDto,
    creatingUserId: string,
  ) {
    const parent = await this.verifyMultiSiteEnabled(parentTenantId);

    // The parent must be a true parent (not a child campus itself)
    if (parent.parentTenantId) {
      throw new BadRequestException(
        'Cannot create a campus under another campus. Use the parent organization ID.',
      );
    }

    // Check slug uniqueness if provided
    if (dto.slug) {
      const existing = await this.dataSource.manager.findOne(Tenant, {
        where: { slug: dto.slug },
      });
      if (existing) {
        throw new BadRequestException(`Slug "${dto.slug}" is already taken`);
      }
    }

    return this.dataSource.transaction(async manager => {
      // Create the campus tenant
      const campus = manager.create(Tenant, {
        name: dto.name ?? `${parent.name} - ${dto.campusName}`,
        campusName: dto.campusName,
        slug: dto.slug ?? null,
        tier: parent.tier,  // Inherit tier from parent
        parentTenantId: parent.id,
        stripeAccountId: parent.stripeAccountId,        // Share Stripe account
        stripeAccountStatus: parent.stripeAccountStatus,
        address: dto.address ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        zip: dto.zip ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        feedIsolation: false,
      });
      const saved = await manager.save(Tenant, campus);

      // Auto-add the creating admin to the new campus
      const membership = manager.create(TenantMembership, {
        userId: creatingUserId,
        tenantId: saved.id,
        role: 'admin',
        permissions: {
          manage_finance: true,
          manage_content: true,
          manage_members: true,
          manage_worship: true,
          view_analytics: true,
        },
      });
      await manager.save(TenantMembership, membership);

      this.logger.log(
        `Campus created: ${saved.id} (${saved.campusName}) under org ${parent.id} by ${creatingUserId}`,
      );

      return {
        id: saved.id,
        name: saved.name,
        campusName: saved.campusName,
        slug: saved.slug,
        parentTenantId: saved.parentTenantId,
        address: saved.address,
        city: saved.city,
        state: saved.state,
        zip: saved.zip,
        latitude: saved.latitude,
        longitude: saved.longitude,
        createdAt: saved.createdAt,
      };
    });
  }

  /**
   * List all campuses in an organization.
   * Can be called from any tenant in the org (parent or child).
   */
  async listCampuses(tenantId: string) {
    const parentId = await this.resolveParentId(tenantId);

    const campuses = await this.dataSource.query(
      `SELECT t.id, t.name, t.campus_name, t.slug, t.parent_tenant_id,
              t.address, t.city, t.state, t.zip, t.latitude, t.longitude,
              t.feed_isolation, t.created_at,
              (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = t.id) AS member_count
       FROM public.tenants t
       WHERE t.id = $1 OR t.parent_tenant_id = $1
       ORDER BY t.parent_tenant_id NULLS FIRST, t.campus_name ASC`,
      [parentId],
    );

    return {
      organizationId: parentId,
      campuses: campuses.map((c: any) => ({
        id: c.id,
        name: c.name,
        campusName: c.campus_name,
        slug: c.slug,
        isParent: c.parent_tenant_id === null,
        address: c.address,
        city: c.city,
        state: c.state,
        zip: c.zip,
        latitude: c.latitude,
        longitude: c.longitude,
        feedIsolation: c.feed_isolation,
        memberCount: c.member_count,
        createdAt: c.created_at,
      })),
    };
  }

  /**
   * Update campus details or toggle feed isolation.
   * Feed isolation can only be set on the parent org and cascades to all campuses.
   */
  async updateCampus(tenantId: string, dto: UpdateCampusDto) {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Campus not found');

    const updates: Partial<Tenant> = {};
    if (dto.campusName !== undefined) updates.campusName = dto.campusName;
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.address !== undefined) updates.address = dto.address;
    if (dto.city !== undefined) updates.city = dto.city;
    if (dto.state !== undefined) updates.state = dto.state;
    if (dto.zip !== undefined) updates.zip = dto.zip;
    if (dto.latitude !== undefined) updates.latitude = dto.latitude;
    if (dto.longitude !== undefined) updates.longitude = dto.longitude;

    // Feed isolation can only be toggled on the parent org
    if (dto.feedIsolation !== undefined) {
      if (tenant.parentTenantId) {
        throw new BadRequestException(
          'Feed isolation can only be toggled on the parent organization, not individual campuses.',
        );
      }
      updates.feedIsolation = dto.feedIsolation;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    await this.dataSource.manager.update(Tenant, { id: tenantId }, updates);

    const updated = await this.dataSource.manager.findOneOrFail(Tenant, {
      where: { id: tenantId },
    });

    return {
      id: updated.id,
      name: updated.name,
      campusName: updated.campusName,
      slug: updated.slug,
      parentTenantId: updated.parentTenantId,
      address: updated.address,
      city: updated.city,
      state: updated.state,
      zip: updated.zip,
      latitude: updated.latitude,
      longitude: updated.longitude,
      feedIsolation: updated.feedIsolation,
    };
  }

  /**
   * Get all tenant IDs in an organization (parent + all campuses).
   * Used by cross-campus aggregation endpoints.
   */
  async getOrgTenantIds(tenantId: string): Promise<string[]> {
    const parentId = await this.resolveParentId(tenantId);
    const rows = await this.dataSource.query(
      `SELECT id FROM public.tenants WHERE id = $1 OR parent_tenant_id = $1`,
      [parentId],
    );
    return rows.map((r: any) => r.id);
  }

  /**
   * Cross-campus aggregated analytics for the "All" view.
   * Combines KPIs from all campuses in the organization.
   */
  async getOrgAnalytics(tenantId: string, range: string) {
    const orgTenantIds = await this.getOrgTenantIds(tenantId);

    const intervalMap: Record<string, string> = {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      'all': '100 years',
    };
    const interval = intervalMap[range] ?? '30 days';

    const [totalMembers, newMembers, totalGiving, givingTrends, campusBreakdown] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(DISTINCT tm.user_id)::int AS total
         FROM public.tenant_memberships tm
         WHERE tm.tenant_id = ANY($1)`,
        [orgTenantIds],
      ),
      this.dataSource.query(
        `SELECT date_trunc('day', tm.created_at)::date AS date, COUNT(*)::int AS count
         FROM public.tenant_memberships tm
         WHERE tm.tenant_id = ANY($1) AND tm.created_at >= now() - $2::interval
         GROUP BY 1 ORDER BY 1`,
        [orgTenantIds, interval],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM public.transactions
         WHERE tenant_id = ANY($1) AND status = 'succeeded' AND created_at >= now() - $2::interval`,
        [orgTenantIds, interval],
      ),
      this.dataSource.query(
        `SELECT date_trunc('day', t.created_at)::date AS date, SUM(t.amount)::float AS amount
         FROM public.transactions t
         WHERE t.tenant_id = ANY($1) AND t.status = 'succeeded' AND t.created_at >= now() - $2::interval
         GROUP BY 1 ORDER BY 1`,
        [orgTenantIds, interval],
      ),
      // Per-campus breakdown
      this.dataSource.query(
        `SELECT
           t.id AS campus_id,
           COALESCE(t.campus_name, t.name) AS campus_name,
           t.parent_tenant_id IS NULL AS is_parent,
           (SELECT COUNT(*)::int FROM public.tenant_memberships WHERE tenant_id = t.id) AS member_count,
           (SELECT COALESCE(SUM(tx.amount), 0)::float FROM public.transactions tx
            WHERE tx.tenant_id = t.id AND tx.status = 'succeeded'
            AND tx.created_at >= now() - $2::interval) AS giving_total,
           (SELECT COUNT(*)::int FROM public.check_ins WHERE tenant_id = t.id
            AND created_at >= now() - $2::interval) AS checkin_count
         FROM public.tenants t
         WHERE t.id = ANY($1)
         ORDER BY t.parent_tenant_id NULLS FIRST, t.campus_name`,
        [orgTenantIds, interval],
      ),
    ]);

    return {
      organizationTenantIds: orgTenantIds,
      totalMembers: totalMembers[0]?.total ?? 0,
      newMembers,
      totalGiving: totalGiving[0]?.total ?? 0,
      givingTrends,
      campusBreakdown: campusBreakdown.map((c: any) => ({
        campusId: c.campus_id,
        campusName: c.campus_name,
        isParent: c.is_parent,
        memberCount: c.member_count,
        givingTotal: c.giving_total,
        checkinCount: c.checkin_count,
      })),
    };
  }

  /**
   * Cross-campus member list for the "All" view.
   * De-duplicates users who are members of multiple campuses.
   */
  async getOrgMembers(tenantId: string, cursor?: string, limit = 20) {
    const orgTenantIds = await this.getOrgTenantIds(tenantId);
    const params: any[] = [orgTenantIds, limit + 1];

    let sql = `
      SELECT DISTINCT ON (u.id)
        u.id, u.email, u.full_name, u.avatar_url,
        tm.role, tm.tenant_id,
        t.campus_name,
        tm.created_at
      FROM public.users u
      JOIN public.tenant_memberships tm ON tm.user_id = u.id
      JOIN public.tenants t ON t.id = tm.tenant_id
      WHERE tm.tenant_id = ANY($1)
    `;

    if (cursor) {
      params.push(cursor);
      sql += ` AND u.id > $${params.length}`;
    }

    sql += ` ORDER BY u.id, tm.created_at ASC LIMIT $2`;

    const rows = await this.dataSource.query(sql, params);
    const hasMore = rows.length > limit;
    const members = hasMore ? rows.slice(0, limit) : rows;

    return {
      members: members.map((m: any) => ({
        id: m.id,
        email: m.email,
        fullName: m.full_name,
        avatarUrl: m.avatar_url,
        role: m.role,
        campusId: m.tenant_id,
        campusName: m.campus_name,
        joinedAt: m.created_at,
      })),
      nextCursor: hasMore ? members[members.length - 1].id : null,
    };
  }

  /**
   * Cross-campus social feed.
   * Returns posts from all campuses in the organization (unless feed_isolation is on).
   */
  async getOrgFeed(tenantId: string, userId: string, limit = 20, offset = 0) {
    const parentId = await this.resolveParentId(tenantId);
    const parent = await this.dataSource.manager.findOne(Tenant, {
      where: { id: parentId },
      select: ['id', 'feedIsolation'],
    });

    // If feed isolation is on, only show posts from the user's current campus
    let targetTenantIds: string[];
    if (parent?.feedIsolation) {
      targetTenantIds = [tenantId];
    } else {
      targetTenantIds = await this.getOrgTenantIds(tenantId);
    }

    const rows = await this.dataSource.query(
      `SELECT
         p.id, p.tenant_id, p.author_id, p.content,
         p.media_type, p.media_url, p.video_mux_playback_id, p.visibility,
         p.created_at, p.updated_at,
         u.id AS u_id, u.email AS u_email, u.full_name AS u_full_name, u.avatar_url AS u_avatar_url,
         t.campus_name AS campus_name,
         (SELECT COUNT(*)::int FROM public.post_likes WHERE post_id = p.id) AS like_count,
         (SELECT COUNT(*)::int FROM public.comments WHERE post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM public.post_likes WHERE post_id = p.id AND user_id = $2) AS is_liked_by_me,
         EXISTS(SELECT 1 FROM public.post_saves WHERE post_id = p.id AND user_id = $2) AS is_saved_by_me
       FROM public.posts p
       LEFT JOIN public.users u ON u.id = p.author_id
       LEFT JOIN public.tenants t ON t.id = p.tenant_id
       WHERE p.tenant_id = ANY($1) AND p.visibility = 'public'
       ORDER BY p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [targetTenantIds, userId, limit, offset],
    );

    const total = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM public.posts
       WHERE tenant_id = ANY($1) AND visibility = 'public'`,
      [targetTenantIds],
    );

    return {
      posts: rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        authorId: r.author_id,
        content: r.content,
        mediaType: r.media_type,
        mediaUrl: r.media_url,
        videoMuxPlaybackId: r.video_mux_playback_id,
        visibility: r.visibility,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        campusName: r.campus_name,
        author: r.u_id ? {
          id: r.u_id,
          email: r.u_email,
          fullName: r.u_full_name,
          avatarUrl: r.u_avatar_url,
        } : null,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        isLikedByMe: r.is_liked_by_me,
        isSavedByMe: r.is_saved_by_me,
      })),
      total: total[0]?.count ?? 0,
      limit,
      offset,
    };
  }
}
