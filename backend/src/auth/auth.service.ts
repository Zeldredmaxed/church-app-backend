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
   * The user will not pass RLS on tenant-scoped tables until they are assigned
   * a membership and call POST /auth/switch-tenant.
   */
  async signup(dto: SignupDto) {
    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      this.logger.warn(`Signup failed for ${dto.email}: ${error.message}`);
      throw new UnauthorizedException(error.message);
    }

    return {
      userId: data.user?.id,
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
}
