import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { RegistrationKey } from './entities/registration-key.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RegisterChurchDto } from './dto/register-church.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { getTierFeatures, TierFeatures, TIER_DISPLAY_NAMES, TierName } from '../common/config/tier-features.config';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly dataSource: DataSource,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {
    this.supabase = supabaseAdmin.client;
  }

  /**
   * Returns all churches with only public-safe fields.
   * No auth required — used by the Join/signup church picker.
   * Optional search query filters by name (case-insensitive).
   */
  async getPublicChurches(q?: string) {
    const params: any[] = [];
    let sql = `SELECT id, name, slug FROM public.tenants`;

    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      sql += ` WHERE name ILIKE $1`;
    }

    sql += ` ORDER BY name ASC LIMIT 100`;

    const rows = await this.dataSource.query(sql, params);
    return rows.map((r: any) => ({ id: r.id, name: r.name, slug: r.slug }));
  }

  /**
   * Creates a new tenant (church). Service-role operation — intentionally bypasses RLS.
   * Only callable from the SuperAdmin-guarded endpoint.
   *
   * Runs as a single atomic transaction:
   *   1. Insert the tenant row.
   *   2. Insert the creating user as 'admin' in tenant_memberships.
   *   3. Set the creator's last_accessed_tenant_id to the new tenant.
   *      (This fires handle_tenant_context_switch, syncing the JWT claim.)
   *
   * After this call, the super admin must call POST /auth/refresh to receive
   * a JWT with the new current_tenant_id.
   */
  async create(dto: CreateTenantDto, creatingUser: SupabaseJwtPayload): Promise<Tenant> {
    return this.dataSource.transaction(async manager => {
      const tenant = manager.create(Tenant, { name: dto.name });
      const savedTenant = await manager.save(Tenant, tenant);

      const membership = manager.create(TenantMembership, {
        userId: creatingUser.sub,
        tenantId: savedTenant.id,
        role: 'admin',
      });
      await manager.save(TenantMembership, membership);

      // Fires handle_tenant_context_switch trigger → updates auth.users JWT metadata
      await manager.update(User, { id: creatingUser.sub }, {
        lastAccessedTenantId: savedTenant.id,
      });

      this.logger.log(
        `Tenant created: ${savedTenant.id} (${savedTenant.name}) by user ${creatingUser.sub}`,
      );

      return savedTenant;
    });
  }

  /**
   * Self-service church registration.
   *
   * Flow:
   *   1. Validate the registration key exists and hasn't been claimed.
   *   2. Check slug uniqueness.
   *   3. Create a Supabase Auth user (pre-confirmed, no email verification).
   *   4. Wait for handle_new_user trigger to create the public.users row.
   *   5. Create the tenant with the tier from the registration key.
   *   6. Add the new user as 'admin' of the tenant.
   *   7. Set the user's last_accessed_tenant_id (fires tenant context trigger).
   *   8. Update the user's full_name.
   *   9. Mark the registration key as claimed.
   *  10. Log the user in and return a JWT.
   *
   * This endpoint is PUBLIC — no JWT required.
   */
  async register(dto: RegisterChurchDto) {
    // Step 1: Validate registration key
    const regKey = await this.dataSource.manager.findOne(RegistrationKey, {
      where: { key: dto.registrationKey },
    });

    if (!regKey) {
      throw new BadRequestException('Invalid registration key');
    }
    if (regKey.claimedBy) {
      throw new BadRequestException('This registration key has already been used');
    }

    // Step 2: Check slug uniqueness
    const existingSlug = await this.dataSource.manager.findOne(Tenant, {
      where: { slug: dto.churchId },
    });
    if (existingSlug) {
      throw new ConflictException(`Church App ID "${dto.churchId}" is already taken`);
    }

    // Step 3: Create Supabase Auth user (pre-confirmed)
    const { data: authData, error: authError } = await this.supabase.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message?.includes('already been registered')) {
        throw new ConflictException('An account with this email already exists');
      }
      this.logger.error(`Supabase auth error during registration: ${authError.message}`);
      throw new InternalServerErrorException('Failed to create user account');
    }

    const userId = authData.user.id;

    try {
      // Step 4: Wait briefly for the handle_new_user trigger to fire
      // The trigger creates the public.users row automatically
      await new Promise(resolve => setTimeout(resolve, 500));

      // Steps 5-9: All in a single DB transaction
      const tenant = await this.dataSource.transaction(async manager => {
        // Step 5: Create tenant
        const newTenant = manager.create(Tenant, {
          name: dto.churchName,
          slug: dto.churchId,
          tier: regKey.tier as Tenant['tier'],
          registrationKey: dto.registrationKey,
        });
        const savedTenant = await manager.save(Tenant, newTenant);

        // Step 6: Add user as admin
        const membership = manager.create(TenantMembership, {
          userId,
          tenantId: savedTenant.id,
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

        // Step 7: Set tenant context (fires handle_tenant_context_switch trigger)
        await manager.update(User, { id: userId }, {
          lastAccessedTenantId: savedTenant.id,
        });

        // Step 8: Update user's full name
        await manager.update(User, { id: userId }, {
          fullName: dto.adminName,
        });

        // Step 9: Mark registration key as claimed
        await manager.update(RegistrationKey, { id: regKey.id }, {
          claimedBy: savedTenant.id,
          claimedAt: new Date(),
        });

        this.logger.log(
          `Church registered: ${savedTenant.id} (${savedTenant.name}) slug=${savedTenant.slug} ` +
          `tier=${savedTenant.tier} admin=${userId}`,
        );

        return savedTenant;
      });

      // Step 10: Log in the new user to get JWT
      const { data: loginData, error: loginError } =
        await this.supabase.auth.signInWithPassword({
          email: dto.email,
          password: dto.password,
        });

      if (loginError) {
        this.logger.warn(`Auto-login failed after registration: ${loginError.message}`);
        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            tier: tenant.tier,
          },
          user: { id: userId, email: dto.email, fullName: dto.adminName },
          message: 'Church created. Please log in manually.',
        };
      }

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          tier: tenant.tier,
        },
        user: { id: userId, email: dto.email, fullName: dto.adminName },
        accessToken: loginData.session!.access_token,
        refreshToken: loginData.session!.refresh_token,
        expiresAt: loginData.session!.expires_at,
      };
    } catch (err) {
      // Cleanup: delete the Supabase Auth user if DB transaction failed
      this.logger.error(`Registration failed for ${dto.email}, cleaning up auth user`);
      await this.supabase.auth.admin.deleteUser(userId).catch(e => this.logger.error(`Failed to clean up auth user ${userId}: ${e.message}`));
      throw err;
    }
  }

  /**
   * Returns a single tenant by ID using the RLS-scoped QueryRunner.
   *
   * RLS enforces isolation: if the authenticated user's current_tenant_id does
   * not match the requested tenant's id, the query returns no rows and a
   * NotFoundException is thrown. The caller cannot distinguish "not found" from
   * "access denied" — this is intentional (avoids tenant ID enumeration).
   */
  async findOne(id: string): Promise<Tenant> {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied to this route.',
      );
    }

    const tenant = await context.queryRunner.manager.findOne(Tenant, {
      where: { id },
    });

    if (!tenant) {
      // Intentionally vague — prevents tenant ID enumeration
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  /**
   * Returns the feature set for a tenant based on its tier.
   * Used by the frontend to bootstrap UI feature flags on login.
   *
   * Uses service-role connection (not RLS) — the tenant ID comes from
   * the verified JWT, not user input.
   */
  async getFeatures(tenantId: string) {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const features = getTierFeatures(tenant.tier);
    const displayName = TIER_DISPLAY_NAMES[tenant.tier as TierName] ?? tenant.tier;

    // If this tenant is part of a multi-site org, include campus info
    let campusInfo: any = null;
    if (tenant.parentTenantId || features.multiSite) {
      const parentId = tenant.parentTenantId ?? tenant.id;
      const campuses = await this.dataSource.query(
        `SELECT id, name, campus_name, parent_tenant_id IS NULL AS is_parent
         FROM public.tenants
         WHERE id = $1 OR parent_tenant_id = $1
         ORDER BY parent_tenant_id NULLS FIRST, campus_name ASC`,
        [parentId],
      );
      campusInfo = {
        isMultiSite: campuses.length > 1 || features.multiSite,
        currentCampusId: tenant.id,
        currentCampusName: tenant.campusName,
        parentOrganizationId: parentId,
        feedIsolation: tenant.feedIsolation,
        campuses: campuses.map((c: any) => ({
          id: c.id,
          name: c.name,
          campusName: c.campus_name,
          isParent: c.is_parent,
        })),
      };
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        tier: tenant.tier,
        tierDisplayName: displayName,
        campusName: tenant.campusName,
        parentTenantId: tenant.parentTenantId,
      },
      features,
      ...(campusInfo ? { campus: campusInfo } : {}),
    };
  }

  /**
   * Returns the public profile for a tenant.
   * Includes member count, post count, and event count.
   */
  async getProfile(tenantId: string) {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const [r1, r2, r3] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS member_count FROM public.tenant_memberships WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS post_count FROM public.posts WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS event_count FROM public.events WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tier: tenant.tier,
      description: (tenant as any).description ?? null,
      location: (tenant as any).location ?? null,
      serviceTimes: (tenant as any).service_times ?? null,
      websiteUrl: (tenant as any).website_url ?? null,
      phone: (tenant as any).phone ?? null,
      coverImageUrl: (tenant as any).cover_image_url ?? null,
      memberCount: Number(r1[0]?.member_count ?? 0),
      postCount: Number(r2[0]?.post_count ?? 0),
      eventCount: Number(r3[0]?.event_count ?? 0),
    };
  }

  /**
   * Returns analytics data for the admin dashboard.
   */
  async getAnalytics(tenantId: string, range: string) {
    const intervalMap: Record<string, string> = {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      'all': '100 years',
    };
    const interval = intervalMap[range] ?? '30 days';

    const [newMembers, givingTrends, totalGivingResult, totalNewMembersResult, topPosts] = await Promise.all([
      this.dataSource.query(
        `SELECT date_trunc('day', tm.created_at)::date AS date, COUNT(*)::int AS count
         FROM public.tenant_memberships tm
         WHERE tm.tenant_id = $1 AND tm.created_at >= now() - $2::interval
         GROUP BY 1 ORDER BY 1`,
        [tenantId, interval],
      ),
      this.dataSource.query(
        `SELECT date_trunc('day', t.created_at)::date AS date, SUM(t.amount)::float AS amount
         FROM public.transactions t
         WHERE t.tenant_id = $1 AND t.status = 'succeeded' AND t.created_at >= now() - $2::interval
         GROUP BY 1 ORDER BY 1`,
        [tenantId, interval],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM public.transactions
         WHERE tenant_id = $1 AND status = 'succeeded' AND created_at >= now() - $2::interval`,
        [tenantId, interval],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM public.tenant_memberships
         WHERE tenant_id = $1 AND created_at >= now() - $2::interval`,
        [tenantId, interval],
      ),
      this.dataSource.query(
        `SELECT p.id, LEFT(p.content, 80) AS title,
           COALESCE(pl.like_count, 0) AS likes,
           COALESCE(c.comment_count, 0) AS comments
         FROM public.posts p
         LEFT JOIN (
           SELECT post_id, COUNT(*)::int AS like_count FROM public.post_likes GROUP BY post_id
         ) pl ON pl.post_id = p.id
         LEFT JOIN (
           SELECT post_id, COUNT(*)::int AS comment_count FROM public.comments GROUP BY post_id
         ) c ON c.post_id = p.id
         WHERE p.tenant_id = $1 AND p.created_at >= now() - $2::interval
         ORDER BY likes DESC, comments DESC
         LIMIT 5`,
        [tenantId, interval],
      ),
    ]);

    return {
      newMembers,
      givingTrends,
      totalGiving: totalGivingResult[0]?.total ?? 0,
      totalNewMembers: totalNewMembersResult[0]?.total ?? 0,
      topPosts: topPosts.map((p: any) => ({
        id: p.id,
        title: p.title,
        likes: Number(p.likes),
        comments: Number(p.comments),
      })),
    };
  }
}
