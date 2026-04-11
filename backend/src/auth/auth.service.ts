import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Tag } from '../tags/entities/tag.entity';
import { MemberTag } from '../tags/entities/member-tag.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly dataSource: DataSource,
  ) {
    this.supabase = supabaseAdmin.client;
  }

  /**
   * Registers a new user via Supabase Auth.
   * The handle_new_user DB trigger automatically creates the public.users row.
   *
   * If tenantId is provided, the user is automatically added as a 'member'
   * of that church, their tenant context is set, and they're logged in —
   * so the frontend can skip the switch-tenant + refresh dance.
   *
   * If tenantId is NOT provided, the user must be invited or manually added.
   */
  async signup(dto: SignupDto) {
    // Create Supabase Auth user (email confirmation required unless tenant flow)
    const signupOptions: any = {
      email: dto.email,
      password: dto.password,
    };

    // If joining a church, pre-confirm the email so they can log in immediately
    if (dto.tenantId) {
      // Verify the tenant exists
      const tenant = await this.dataSource.manager.findOne(Tenant, {
        where: { id: dto.tenantId },
        select: ['id', 'name'],
      });
      if (!tenant) {
        throw new UnauthorizedException('Church not found');
      }
    }

    const { data, error } = dto.tenantId
      ? await this.supabase.auth.admin.createUser({
          email: dto.email,
          password: dto.password,
          email_confirm: true,
        })
      : await this.supabase.auth.signUp(signupOptions);

    if (error) {
      this.logger.warn(`Signup failed for ${dto.email}: ${error.message}`);
      if (error.message?.includes('already been registered')) {
        throw new UnauthorizedException('An account with this email already exists');
      }
      throw new UnauthorizedException(error.message);
    }

    const userId = data.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Failed to create user account');
    }

    // If joining a church, set up membership + context + fullName in one step
    if (dto.tenantId) {
      // Wait for the handle_new_user trigger to create the public.users row
      await new Promise(resolve => setTimeout(resolve, 500));

      await this.dataSource.transaction(async manager => {
        // Add as member
        await manager.save(
          TenantMembership,
          manager.create(TenantMembership, {
            userId,
            tenantId: dto.tenantId!,
            role: 'member',
          }),
        );

        // Set tenant context (fires handle_tenant_context_switch trigger)
        const updates: Partial<User> = { lastAccessedTenantId: dto.tenantId! };
        if (dto.fullName) updates.fullName = dto.fullName;
        await manager.update(User, { id: userId }, updates);

        // Auto-assign "Guest" tag — create it for this tenant if it doesn't exist
        let guestTag = await manager.findOne(Tag, {
          where: { tenantId: dto.tenantId!, name: 'Guest' },
        });
        if (!guestTag) {
          guestTag = await manager.save(
            Tag,
            manager.create(Tag, {
              tenantId: dto.tenantId!,
              name: 'Guest',
              color: '#9CA3AF', // gray
            }),
          );
        }
        await manager.query(
          `INSERT INTO public.member_tags (tag_id, user_id, assigned_by)
           VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
          [guestTag.id, userId],
        );

        // Process onboarding form responses if provided
        if (dto.onboardingResponses && Object.keys(dto.onboardingResponses).length > 0) {
          const [form] = await manager.query(
            `SELECT id FROM public.onboarding_forms WHERE tenant_id = $1 AND is_active = true`,
            [dto.tenantId],
          );
          if (form) {
            // Save responses
            await manager.query(
              `INSERT INTO public.onboarding_responses (tenant_id, user_id, form_id, responses)
               VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (user_id, tenant_id) DO UPDATE SET responses = $4::jsonb, submitted_at = now()`,
              [dto.tenantId, userId, form.id, JSON.stringify(dto.onboardingResponses)],
            );

            // Auto-populate journey data from mapped fields
            const resp = dto.onboardingResponses;
            const journeyUpdates: Record<string, any> = {};
            if (resp.is_baptized !== undefined) journeyUpdates.is_baptized = resp.is_baptized;
            if (resp.baptism_date) journeyUpdates.baptism_date = resp.baptism_date;
            if (resp.salvation_date) journeyUpdates.salvation_date = resp.salvation_date;
            if (resp.is_saved === true && !resp.salvation_date) {
              journeyUpdates.salvation_date = new Date().toISOString().split('T')[0];
            }
            if (resp.interests) journeyUpdates.interests = resp.interests;
            if (resp.skills) journeyUpdates.skills = resp.skills;
            if (resp.faith_journey) {
              const trackMap: Record<string, string> = {
                'Just exploring': 'exploring',
                'New believer': 'foundations',
                'Growing in faith': 'growth',
                'Mature believer': 'maturity',
                'Ready to lead/serve': 'leadership',
              };
              journeyUpdates.discipleship_track = trackMap[resp.faith_journey] ?? 'exploring';
            }

            if (Object.keys(journeyUpdates).length > 0) {
              await manager.query(
                `INSERT INTO public.member_journeys (tenant_id, user_id, is_baptized, baptism_date, salvation_date, interests, skills, discipleship_track)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                   is_baptized = COALESCE($3, member_journeys.is_baptized),
                   baptism_date = COALESCE($4, member_journeys.baptism_date),
                   salvation_date = COALESCE($5, member_journeys.salvation_date),
                   interests = COALESCE($6, member_journeys.interests),
                   skills = COALESCE($7, member_journeys.skills),
                   discipleship_track = COALESCE($8, member_journeys.discipleship_track),
                   updated_at = now()`,
                [
                  dto.tenantId,
                  userId,
                  journeyUpdates.is_baptized ?? null,
                  journeyUpdates.baptism_date ?? null,
                  journeyUpdates.salvation_date ?? null,
                  journeyUpdates.interests ? `{${journeyUpdates.interests.join(',')}}` : null,
                  journeyUpdates.skills ? `{${journeyUpdates.skills.join(',')}}` : null,
                  journeyUpdates.discipleship_track ?? null,
                ],
              );
            }
          }
        }
      });

      // Auto-login so the frontend gets tokens immediately
      const { data: loginData, error: loginError } =
        await this.supabase.auth.signInWithPassword({
          email: dto.email,
          password: dto.password,
        });

      if (loginError) {
        this.logger.warn(`Auto-login after signup failed: ${loginError.message}`);
        return {
          userId,
          email: dto.email,
          tenantId: dto.tenantId,
          message: 'Account created and joined church. Please log in manually.',
        };
      }

      return {
        userId,
        email: dto.email,
        fullName: dto.fullName ?? null,
        tenantId: dto.tenantId,
        accessToken: loginData.session!.access_token,
        refreshToken: loginData.session!.refresh_token,
        expiresAt: loginData.session!.expires_at,
        message: 'Account created and joined church.',
      };
    }

    // Standard signup (no church) — requires email confirmation
    return {
      userId,
      email: data.user?.email,
      message: 'Account created. Check your email to confirm before logging in.',
    };
  }

  /**
   * Authenticates a user and returns session tokens.
   * The returned accessToken is a Supabase JWT containing current_tenant_id
   * in app_metadata (if the user has been assigned a tenant).
   */
  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Record login for streak tracking (fire-and-forget)
    this.recordLogin(data.user!.id).catch(() => {});

    return {
      accessToken: data.session!.access_token,
      refreshToken: data.session!.refresh_token,
      expiresAt: data.session!.expires_at,
      user: {
        id: data.user!.id,
        email: data.user!.email,
        currentTenantId: data.user!.app_metadata?.current_tenant_id ?? null,
      },
    };
  }

  /**
   * Exchanges a refresh token for a new access token.
   * The client MUST call this after POST /auth/switch-tenant to receive
   * a JWT with the updated current_tenant_id claim.
   */
  async refresh(dto: RefreshDto) {
    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: dto.refreshToken,
    });

    if (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      accessToken: data.session!.access_token,
      refreshToken: data.session!.refresh_token,
      expiresAt: data.session!.expires_at,
    };
  }

  /**
   * Sends a password reset email via Supabase.
   *
   * Supabase sends an email with a magic link. When the user clicks it,
   * they're redirected to `redirectTo` with access/refresh tokens in the
   * URL hash. The frontend exchanges those for a session, then calls
   * POST /auth/reset-password with the new password.
   *
   * Always returns success to prevent email enumeration.
   */
  async forgotPassword(dto: ForgotPasswordDto, redirectTo?: string) {
    const { error } = await this.supabase.auth.resetPasswordForEmail(
      dto.email,
      { redirectTo },
    );

    if (error) {
      // Log but don't expose — prevents email enumeration
      this.logger.warn(`Password reset request failed for ${dto.email}: ${error.message}`);
    }

    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Resets the user's password using a valid session from the reset link.
   *
   * The frontend must first exchange the tokens from the reset link URL hash
   * into a Supabase session (via supabase.auth.setSession or getSession),
   * then call this endpoint with the new password and the access token
   * in the Authorization header.
   */
  async resetPassword(dto: ResetPasswordDto, accessToken: string) {
    // Use the user's access token from the reset flow to update their password
    const { error } = await this.supabase.auth.admin.updateUserById(
      // Decode the sub from the token to get the user ID
      (await this.extractUserId(accessToken)),
      { password: dto.password },
    );

    if (error) {
      this.logger.warn(`Password reset failed: ${error.message}`);
      throw new UnauthorizedException('Password reset failed. The link may have expired.');
    }

    return { message: 'Password updated successfully. You can now log in with your new password.' };
  }

  private async extractUserId(accessToken: string): Promise<string> {
    const { data, error } = await this.supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    return data.user.id;
  }

  /**
   * Switches the user's active tenant context.
   *
   * Flow:
   *   1. Verify the user has a membership in the requested tenant (service role query).
   *   2. Update public.users.last_accessed_tenant_id.
   *   3. The handle_tenant_context_switch DB trigger syncs the new tenant_id
   *      into auth.users.raw_app_meta_data automatically.
   *   4. The client MUST call POST /auth/refresh to get a new JWT with the
   *      updated current_tenant_id before making any further tenant-scoped requests.
   *
   * This uses dataSource.manager (service role) intentionally — we need to verify
   * membership across tenant boundaries without the old JWT's RLS restriction.
   */
  /**
   * Logout endpoint. Since Supabase JWTs are stateless, the client simply
   * discards the token. This endpoint exists for API completeness.
   */
  async logout(userId: string) {
    // Mark user as offline
    await this.dataSource.query(
      `UPDATE public.users SET is_online = false WHERE id = $1`,
      [userId],
    );
    return { message: 'Logged out successfully. Discard your tokens.' };
  }

  /**
   * Returns a session summary: user profile, tenant memberships, and current tenant.
   * Used by the frontend to bootstrap the app on page load.
   */
  async getSession(userId: string) {
    const user = await this.dataSource.manager.findOne(User, {
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const memberships = await this.dataSource.manager.query(
      `SELECT tm.tenant_id, tm.role, tm.permissions, t.name AS tenant_name, t.slug AS tenant_slug
       FROM public.tenant_memberships tm
       JOIN public.tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = $1
       ORDER BY t.name ASC`,
      [userId],
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
      memberships: memberships.map((m: any) => ({
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        tenantSlug: m.tenant_slug,
        role: m.role,
        permissions: m.permissions,
      })),
      currentTenantId: user.lastAccessedTenantId,
    };
  }

  async switchTenant(user: SupabaseJwtPayload, dto: SwitchTenantDto) {
    const membership = await this.dataSource.manager.findOne(TenantMembership, {
      where: { userId: user.sub, tenantId: dto.tenantId },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this tenant');
    }

    await this.dataSource.manager.update(
      User,
      { id: user.sub },
      { lastAccessedTenantId: dto.tenantId },
    );

    return {
      message: 'Context switched. Call POST /api/auth/refresh to receive your updated JWT.',
      currentTenantId: dto.tenantId,
      yourRole: membership.role,
    };
  }

  /**
   * Records a login for streak tracking. Uses a raw upsert query
   * so it works without the LoginStreak entity imported here.
   */
  private async recordLogin(userId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO public.login_streaks (user_id, current_streak, longest_streak, last_login_date, updated_at)
       VALUES ($1, 1, 1, CURRENT_DATE, now())
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
           WHEN login_streaks.last_login_date = CURRENT_DATE THEN login_streaks.current_streak
           ELSE 1
         END,
         longest_streak = GREATEST(
           login_streaks.longest_streak,
           CASE
             WHEN login_streaks.last_login_date = CURRENT_DATE - 1 THEN login_streaks.current_streak + 1
             WHEN login_streaks.last_login_date = CURRENT_DATE THEN login_streaks.current_streak
             ELSE 1
           END
         ),
         last_login_date = CURRENT_DATE,
         updated_at = now()`,
      [userId],
    );
  }
}
