import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.getOrThrow('SUPABASE_URL'),
      config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
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
      await this.supabase.auth.admin.deleteUser(userId).catch(() => {});
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
      select: ['id', 'name', 'tier', 'slug'],
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const features = getTierFeatures(tenant.tier);
    const displayName = TIER_DISPLAY_NAMES[tenant.tier as TierName] ?? tenant.tier;

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        tier: tenant.tier,
        tierDisplayName: displayName,
      },
      features,
    };
  }
}
