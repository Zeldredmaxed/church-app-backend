import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Inject,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tenant } from './entities/tenant.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { RegistrationKey } from './entities/registration-key.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { RegisterChurchDto } from './dto/register-church.dto';
import { TenantSignupDto } from './dto/signup.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { getTierFeatures, TierFeatures, TIER_DISPLAY_NAMES, TIER_MONTHLY_PRICE_CENTS, TIER_YEARLY_PRICE_CENTS, TierName } from '../common/config/tier-features.config';
import { CacheService } from '../common/services/cache.service';
import { StripeService } from '../stripe/stripe.service';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly dataSource: DataSource,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly cache: CacheService,
    @Inject(forwardRef(() => StripeService))
    private readonly stripe: StripeService,
    private readonly email: EmailService,
  ) {
    this.supabase = supabaseAdmin.client;
  }

  /**
   * Returns all churches with only public-safe fields.
   * No auth required — used by the Join/signup church picker.
   * Optional search query filters by name (case-insensitive).
   */
  /**
   * Public church chooser list used during signup and from the "Change
   * Church" screen in settings. The No Church Home guest tenant is always
   * returned first (when it matches the filter) so the mobile can render
   * it as a pinned top option without extra client-side sorting.
   *
   * Branch info: each row carries parentTenantId + campusName so the
   * frontend can group sibling campuses under their parent organization
   * — same shape as the membership list, so the renderers can stay in
   * sync.
   */
  async getPublicChurches(q?: string) {
    const params: any[] = [];
    let sql = `
      SELECT id, name, slug, brand_color, is_guest,
             parent_tenant_id, campus_name
      FROM public.tenants`;

    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      sql += ` WHERE name ILIKE $1`;
    }

    // Guest tenant pinned to position 0; everything else alphabetical.
    sql += ` ORDER BY is_guest DESC, name ASC LIMIT 200`;

    const rows = await this.dataSource.query(sql, params);
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      brandColor: r.brand_color,
      isGuest: r.is_guest,
      parentTenantId: r.parent_tenant_id,
      campusName: r.campus_name,
    }));
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
      // INTENTIONAL: don't leak which emails already exist. A specific
      // "email already registered" message lets an attacker enumerate
      // every Shepard account — particularly damaging on a church
      // platform (clergy, abuse-survivor contacts, etc.). Log the real
      // reason server-side; return the same generic shape regardless.
      this.logger.warn(
        `Registration auth error (returned generic to caller): ${authError.message}`,
      );
      throw new BadRequestException(
        'Registration could not be completed. Verify your details and try again.',
      );
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
          // Admin role bypasses permission checks (see PermissionsGuard),
          // so this object is informational. Keys aligned with the
          // post-migration-100 catalog.
          permissions: {
            manage_finance: true,
            manage_communications: true,
            manage_members: true,
            manage_sermons: true,
            view_reports: true,
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
          brandColor: tenant.brandColor,
          isGuest: tenant.isGuest,
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
        brandColor: tenant.brandColor,
        isGuest: tenant.isGuest,
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
    return this.cache.wrap(`tenant:profile:${tenantId}`, 300, () => this._getProfile(tenantId));
  }

  // Service-role: public profile page, tenant_id enforced by lookup
  private async _getProfile(tenantId: string) {
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
      brandColor: tenant.brandColor,
      isGuest: tenant.isGuest,
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

  // ════════════════════ First-customer signup (migration 100) ════════════════════

  /**
   * Public new-church signup. Creates a Stripe Checkout subscription
   * session and returns the hosted URL. The tenant + founding admin
   * do NOT exist yet — they're materialized by completeSignup() below,
   * which fires from the checkout.session.completed webhook. This
   * means a customer who bails out mid-payment never creates an
   * orphan tenant row.
   *
   * Pending signup data rides along on the Stripe session's metadata.
   * Stripe metadata values are strings ≤ 500 chars each, so the
   * address goes as a JSON-stringified blob.
   */
  async startSignup(dto: TenantSignupDto, urls: { successUrlBase: string; cancelUrlBase: string }): Promise<{ checkoutUrl: string }> {
    // No pre-flight existing-user check here. The previous version called
    // supabase.auth.admin.listUsers() which (a) breaks silently past the
    // default 50-user pagination cap (silent dedup miss → infinite
    // webhook retry storm at the 51st platform user), and (b) turned
    // this public endpoint into a PII enumeration oracle via timing /
    // Stripe error responses. completeSignup() handles the get-or-create
    // path idempotently via direct SQL — that's where the lookup belongs.

    const tier = dto.tier;
    const billingInterval = dto.billingInterval ?? 'monthly';
    const amountCents = billingInterval === 'yearly'
      ? TIER_YEARLY_PRICE_CENTS[tier]
      : TIER_MONTHLY_PRICE_CENTS[tier];
    const tierLabel = TIER_DISPLAY_NAMES[tier];

    // success_url → admin dashboard (where the magic-link consumer lives)
    // cancel_url → marketing site pricing page
    const successUrl = `${urls.successUrlBase.replace(/\/$/, '')}/welcome?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${urls.cancelUrlBase.replace(/\/$/, '')}/pricing?checkout=cancelled`;

    // Deterministic idempotency key — Stripe holds these for 24h. A
    // double-tap / network retry within the human-attempt window
    // returns the same Checkout session instead of creating a second
    // one. Keyed on the inputs that should uniquely identify ONE
    // intent (admin email + tier + billing interval + church name).
    // billingInterval included so a monthly attempt and a subsequent
    // yearly attempt don't collide on the same cached session.
    const idempotencyKey = createHash('sha256')
      .update(`signup:${dto.adminEmail.toLowerCase()}:${tier}:${billingInterval}:${dto.churchName}`)
      .digest('hex')
      .slice(0, 40);

    const session = await this.stripe.createNewTenantSignupSession({
      tier,
      amountCents,
      tierLabel,
      billingInterval,
      successUrl,
      cancelUrl,
      adminEmail: dto.adminEmail,
      signupMetadata: {
        churchName: dto.churchName,
        adminFullName: dto.adminFullName,
        adminEmail: dto.adminEmail,
        tier,
        billingInterval,
        addressStreet: dto.address.street,
        addressCity: dto.address.city,
        addressState: dto.address.state,
        addressPostalCode: dto.address.postalCode,
        addressCountry: dto.address.country ?? 'US',
      },
      idempotencyKey,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe did not return a checkout URL');
    }
    this.logger.log(`startSignup: created session ${session.id} for ${dto.adminEmail}`);
    return { checkoutUrl: session.url };
  }

  /**
   * Called by the checkout.session.completed webhook when
   * metadata.flow === 'new_tenant_signup'. Idempotent via the
   * tenant_signup_completions dedupe table (PK = stripe_session_id):
   * webhook retries return the same tenant/admin without
   * double-creation.
   *
   * Steps:
   *   1. Dedupe check (return early if this session already produced)
   *   2. Create or reuse Supabase auth user for adminEmail
   *   3. Insert tenant + founding admin membership
   *   4. Stamp Stripe billing IDs onto the tenant
   *   5. Insert dedupe row
   *   6. Send magic-link login email
   *
   * Everything runs on the service-role connection (no JWT context —
   * called from the webhook). RLS is bypassed; tenant_id is set
   * explicitly from the new row's id.
   */
  async completeSignup(args: {
    stripeSessionId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    churchName: string;
    adminFullName: string;
    adminEmail: string;
    tier: 'standard' | 'premium' | 'enterprise';
    address: { street: string; city: string; state: string; postalCode: string; country?: string };
    welcomeBaseUrl: string;
  }): Promise<{ tenantId: string; adminUserId: string; alreadyCompleted: boolean }> {
    // 1. Dedupe — webhook retries.
    const [existing] = await this.dataSource.query(
      `SELECT tenant_id, admin_user_id FROM public.tenant_signup_completions WHERE stripe_session_id = $1`,
      [args.stripeSessionId],
    );
    if (existing) {
      this.logger.log(`completeSignup: session ${args.stripeSessionId} already completed → tenant ${existing.tenant_id}`);
      return { tenantId: existing.tenant_id, adminUserId: existing.admin_user_id, alreadyCompleted: true };
    }

    // 2. Get-or-create Supabase auth user.
    //
    // Direct SQL on auth.users keyed by email (case-insensitive) — the
    // previous version used supabase.auth.admin.listUsers() which is
    // unpaginated and breaks at the 51st platform user (the SDK default
    // page size). Service-role connection can query the auth schema
    // directly; safer + O(1) with the auth.users email index.
    const [existingAuth] = await this.dataSource.query(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [args.adminEmail],
    );
    let adminUserId: string;
    if (existingAuth?.id) {
      adminUserId = existingAuth.id;
    } else {
      const { data: created, error: createErr } = await this.supabase.auth.admin.createUser({
        email: args.adminEmail,
        email_confirm: true, // pre-confirmed; we vetted them via paid checkout
        user_metadata: { full_name: args.adminFullName },
      });
      if (createErr || !created?.user) {
        throw new InternalServerErrorException(`Failed to create Supabase user: ${createErr?.message}`);
      }
      adminUserId = created.user.id;
    }

    // 3. Insert tenant + public.users row + membership in a transaction.
    //
    // pg_advisory_xact_lock keyed on the session id hash serializes
    // concurrent webhook deliveries for the SAME session. Stripe
    // occasionally double-delivers within ~50ms; without this lock both
    // deliveries pass the dedupe SELECT, both insert tenants, only one
    // wins the dedupe PK, but BOTH tenant rows survive (orphan billing).
    // pg_advisory_xact_lock auto-releases at txn end.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let tenantId: string;
    try {
      await queryRunner.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [args.stripeSessionId],
      );

      // Re-check dedupe INSIDE the lock — another worker may have just
      // completed it. Return early to caller via thrown signal pattern.
      const [recheck] = await queryRunner.query(
        `SELECT tenant_id, admin_user_id FROM public.tenant_signup_completions
         WHERE stripe_session_id = $1`,
        [args.stripeSessionId],
      );
      if (recheck) {
        await queryRunner.commitTransaction();
        await queryRunner.release();
        this.logger.log(
          `completeSignup: session ${args.stripeSessionId} completed by concurrent worker → tenant ${recheck.tenant_id}`,
        );
        return { tenantId: recheck.tenant_id, adminUserId: recheck.admin_user_id, alreadyCompleted: true };
      }

      // public.users row (handle_new_user trigger may have already
      // created it via the Supabase auth event; ON CONFLICT idempotent).
      await queryRunner.query(
        `INSERT INTO public.users (id, email, full_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(EXCLUDED.full_name, public.users.full_name)`,
        [adminUserId, args.adminEmail, args.adminFullName],
      );

      // Tenant.
      const [tenantRow] = await queryRunner.query(
        `INSERT INTO public.tenants (name, tier, address, city, state, zip, country, stripe_billing_customer_id, stripe_billing_subscription_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          args.churchName,
          args.tier,
          args.address.street,
          args.address.city,
          args.address.state,
          args.address.postalCode,
          args.address.country ?? 'US',
          args.stripeCustomerId,
          args.stripeSubscriptionId,
        ],
      );
      tenantId = tenantRow.id;

      // Founding admin membership. DO NOTHING (not DO UPDATE) — the
      // tenant was just created on the line above so a pre-existing
      // membership is impossible by construction; the DO NOTHING guards
      // against accidentally demoting a higher role if this ever gets
      // re-entered via a code-path change.
      await queryRunner.query(
        `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, permissions)
         VALUES ($1, $2, 'admin', $3::jsonb)
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [tenantId, adminUserId, JSON.stringify({})],
      );

      // Dedupe row (PK enforces idempotency on the webhook).
      await queryRunner.query(
        `INSERT INTO public.tenant_signup_completions (stripe_session_id, tenant_id, admin_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (stripe_session_id) DO NOTHING`,
        [args.stripeSessionId, tenantId, adminUserId],
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // 4. Set current_tenant_id on the Supabase user so their first
    // login lands in the new church without a switch-tenant call.
    try {
      await this.supabase.auth.admin.updateUserById(adminUserId, {
        app_metadata: { current_tenant_id: tenantId },
      });
    } catch (err: any) {
      this.logger.warn(`completeSignup: failed to set current_tenant_id for ${adminUserId}: ${err.message}`);
      // Non-fatal — they can switch in-app.
    }

    // 5. Magic-link email. Non-blocking — failure doesn't roll back
    // tenant creation (we just log; user can request a reset link).
    //
    // welcomeBaseUrl arrives as the ADMIN dashboard URL (not the
    // marketing site). The webhook controller resolves this from
    // ADMIN_DASHBOARD_URL env (with PUBLIC_SITE_URL as fallback).
    // The dashboard must have a /welcome route that consumes the
    // Supabase magic-link hash and lands the user on the home screen
    // — coordinate with the admin team.
    try {
      const { data: linkData, error: linkErr } = await this.supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: args.adminEmail,
        options: {
          redirectTo: `${args.welcomeBaseUrl.replace(/\/$/, '')}/welcome`,
        },
      });
      if (linkErr || !linkData?.properties?.action_link) {
        // Elevated from warn → error so it surfaces in alerting (Render
        // log stream + future Sentry). A founding admin who never gets
        // their welcome link is locked out with no recovery.
        this.logger.error(
          `completeSignup: magic-link generation FAILED for ${args.adminEmail} (tenant created but admin cannot log in): ${linkErr?.message}`,
        );
      } else {
        const actionLink = linkData.properties.action_link;
        // Defense-in-depth: any URL embedded in HTML must be both URL-
        // validated and HTML-attribute-escaped. action_link comes from
        // Supabase (currently safe) but we don't want a future change
        // to make redirectTo admin-supplied and silently introduce XSS.
        if (!actionLink.startsWith('https://')) {
          this.logger.error(
            `completeSignup: refusing non-https magic link for ${args.adminEmail}: ${actionLink.slice(0, 80)}`,
          );
        } else {
          const escapedLink = escapeHtml(actionLink);
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
              <h1 style="color: #1a1a1a; margin-bottom: 8px;">Welcome to Shepard, ${escapeHtml(args.adminFullName)}!</h1>
              <p style="color: #555;">Your church <strong>${escapeHtml(args.churchName)}</strong> is all set up. Click the button below to sign in for the first time — no password needed.</p>
              <p style="margin: 32px 0;">
                <a href="${escapedLink}" style="background: #1a73e8; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Sign in to Shepard</a>
              </p>
              <p style="color: #888; font-size: 13px;">If the button doesn't work, copy this link into your browser:<br><code style="word-break: break-all;">${escapedLink}</code></p>
              <p style="color: #888; font-size: 13px; margin-top: 32px;">This link expires in 1 hour. If you didn't sign up, you can ignore this email.</p>
            </div>
          `;
          const result = await this.email.send({
            to: args.adminEmail,
            subject: `Welcome to Shepard — sign in to ${args.churchName}`,
            html,
            text: `Welcome to Shepard, ${args.adminFullName}! Sign in here: ${actionLink}`,
            tags: [{ name: 'kind', value: 'welcome_magic_link' }],
          });
          if (result.error || result.id === null) {
            this.logger.error(
              `completeSignup: welcome email send FAILED for ${args.adminEmail}: ${result.error ?? 'dry-run (RESEND_API_KEY missing?)'}`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`completeSignup: magic-link email exception: ${err.message}`);
    }

    this.logger.log(`completeSignup: tenant ${tenantId} + admin ${adminUserId} created from session ${args.stripeSessionId}`);
    return { tenantId, adminUserId, alreadyCompleted: false };
  }

  // ════════════════════ Church profile editing (migration 100) ════════════════════

  /**
   * PATCH /api/tenants/:id — partial update of church profile fields.
   * Caller is admin/pastor for THIS tenant (guarded at controller +
   * verified against live DB membership below — JWT role can be stale
   * for up to 1 hour after a membership change, so we don't trust it
   * for destructive operations).
   * Only the listed fields are updatable; everything else is ignored.
   */
  /** Standard RLS-context helper (matches other service patterns). */
  private getRlsContext() {
    const ctx = rlsStorage.getStore();
    if (!ctx) throw new InternalServerErrorException('RLS context unavailable');
    return ctx;
  }

  async updateTenant(tenantId: string, userId: string, dto: UpdateTenantDto): Promise<Tenant> {
    const { queryRunner } = this.getRlsContext();

    // Live DB role check — defense against a stale JWT carrying an
    // admin/pastor role that was revoked in the meantime. The RLS
    // policy on tenants.UPDATE also gates on role via subquery, so
    // this is belt-and-suspenders, but it gives a cleaner 403 error
    // than the RLS-driven "0 rows affected" path that surfaces as
    // NotFoundException.
    const [membership] = await queryRunner.query(
      `SELECT role FROM public.tenant_memberships
       WHERE tenant_id = $1 AND user_id = $2 AND role IN ('admin','pastor')
       LIMIT 1`,
      [tenantId, userId],
    );
    if (!membership) {
      throw new ForbiddenException(
        'You are not an admin or pastor of this tenant',
      );
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const push = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (dto.name !== undefined) push('name', dto.name);
    if (dto.address?.street !== undefined) push('address', dto.address.street);
    if (dto.address?.city !== undefined) push('city', dto.address.city);
    if (dto.address?.state !== undefined) push('state', dto.address.state);
    if (dto.address?.postalCode !== undefined) push('zip', dto.address.postalCode);
    if (dto.address?.country !== undefined) push('country', dto.address.country);
    if (dto.brandColor !== undefined) push('brand_color', dto.brandColor);
    if (dto.timezone !== undefined) push('timezone', dto.timezone);
    if (dto.monthlyGivingGoalCents !== undefined) push('monthly_giving_goal_cents', dto.monthlyGivingGoalCents);

    if (updates.length === 0) {
      // Nothing to update — return current state rather than error.
      return this.findOne(tenantId);
    }

    params.push(tenantId);
    const [row] = await queryRunner.query(
      `UPDATE public.tenants SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException('Tenant not found');
    return row as Tenant;
  }
}

/** Minimal HTML escape for email body interpolation. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
