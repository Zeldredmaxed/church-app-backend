import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  GoneException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import { rlsStorage } from '../common/storage/rls.storage';
import { Invitation } from './entities/invitation.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { SignupAndAcceptInvitationDto } from './dto/signup-and-accept.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../common/services/email.service';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';

const INVITATION_TTL_HOURS = 24;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  /**
   * Returns all pending (unaccepted) invitations for the current tenant.
   * Augments each with an isExpired flag so the UI can show stale invitations.
   * RLS SELECT policy enforces admin/pastor-only access.
   */
  async getInvitations(): Promise<Array<Invitation & { isExpired: boolean }>> {
    const { queryRunner } = this.getRlsContext();
    const now = new Date();

    const invitations = await queryRunner.manager.find(Invitation, {
      where: { acceptedAt: IsNull(), cancelledAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return invitations.map(inv => ({
      ...inv,
      // Mask the token in list responses — only returned on creation (dev only)
      token: '[hidden]',
      isExpired: inv.expiresAt < now,
    }));
  }

  /**
   * Creates a time-limited invitation for the current tenant.
   *
   * Guards (in order):
   *   1. Active tenant context must be present in JWT.
   *   2. Target email must not already be a member of this tenant.
   *   3. No pending (unaccepted) invitation already exists for this email+tenant
   *      (enforced by unique partial index at DB level; caught and rethrown here).
   *   4. RLS INSERT policy enforces admin/pastor role at DB level.
   *
   * Token security:
   *   - Generated with crypto.randomBytes(32) — 256 bits of entropy.
   *   - In production: token must be sent ONLY via email, never in the API response.
   *   - DEV ONLY: token is included in the response for testing without email service.
   */
  async createInvitation(
    dto: CreateInvitationDto,
    requestingUser: SupabaseJwtPayload,
  ): Promise<Invitation> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    if (!currentTenantId) {
      throw new BadRequestException(
        'No active tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    // Guard: check if the target email is already a member (service role — cross-tenant lookup)
    const existingMembership = await this.dataSource.query(
      `SELECT tm.role FROM public.tenant_memberships tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE lower(u.email) = lower($1) AND tm.tenant_id = $2`,
      [dto.email, currentTenantId],
    );

    if (existingMembership.length > 0) {
      throw new ConflictException(
        `${dto.email} is already a member of this tenant with role '${existingMembership[0].role}'`,
      );
    }

    // Guard: check for an existing pending invitation (graceful error before hitting unique index)
    const existingInvite = await queryRunner.manager.findOne(Invitation, {
      where: { email: dto.email.toLowerCase(), tenantId: currentTenantId, acceptedAt: IsNull() },
    });

    if (existingInvite) {
      const isExpired = existingInvite.expiresAt < new Date();
      if (isExpired) {
        // Delete the stale invitation so a fresh one can be created
        await queryRunner.manager.remove(Invitation, existingInvite);
      } else {
        throw new ConflictException(
          `A pending invitation for ${dto.email} already exists. Cancel it before re-inviting.`,
        );
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

    const invitation = queryRunner.manager.create(Invitation, {
      tenantId: currentTenantId,
      invitedBy: requestingUser.sub,
      email: dto.email.toLowerCase(),
      role: dto.role,
      token,
      expiresAt,
    });

    const saved = await queryRunner.manager.save(Invitation, invitation);

    // Audit the admin action — the "how did this person get into our tenant"
    // trail starts here. target_user_id is intentionally null because the
    // invitee doesn't yet have a user row tied to this tenant.
    const [actor] = await queryRunner.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [requestingUser.sub],
    );
    await this.audit.log({
      action: 'member.invited',
      resourceType: 'user',
      resourceId: saved.id,
      summary: `${actor?.full_name ?? 'Admin'} invited ${dto.email} as ${dto.role}`,
      metadata: {
        email: saved.email,
        role: saved.role,
        invitationId: saved.id,
        expiresAt: saved.expiresAt,
      },
    });

    this.logger.log(
      `Invitation created: ${saved.id} for ${dto.email} in tenant ${currentTenantId}`,
    );

    // Migration 100: send the invitation email via Resend. Best-effort —
    // a delivery failure is logged but doesn't roll back the persisted
    // invitation row (admin can re-send by deleting + re-creating).
    try {
      const [tenant] = await this.dataSource.query(
        `SELECT name FROM public.tenants WHERE id = $1`,
        [currentTenantId],
      );
      const tenantName = tenant?.name ?? 'a Shepard church';
      const inviterName = actor?.full_name ?? 'A pastor';
      const baseUrl = this.config.get<string>('PUBLIC_SITE_URL') ?? 'https://shepard.love';
      const acceptUrl = `${baseUrl.replace(/\/$/, '')}/invite?token=${encodeURIComponent(token)}`;
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <h1 style="color: #1a1a1a; margin-bottom: 8px;">You're invited to ${escapeHtml(tenantName)}</h1>
          <p style="color: #555;">${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(tenantName)}</strong> on Shepard as <strong>${escapeHtml(dto.role)}</strong>.</p>
          <p style="margin: 32px 0;">
            <a href="${acceptUrl}" style="background: #1a73e8; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Accept invitation</a>
          </p>
          <p style="color: #888; font-size: 13px;">If the button doesn't work, copy this link into your browser:<br><code style="word-break: break-all;">${acceptUrl}</code></p>
          <p style="color: #888; font-size: 13px; margin-top: 32px;">This invitation expires ${expiresAt.toUTCString()}. If you weren't expecting this, you can ignore the email.</p>
        </div>
      `;
      await this.email.send({
        to: dto.email,
        subject: `${inviterName} invited you to join ${tenantName} on Shepard`,
        html,
        text: `${inviterName} invited you to join ${tenantName} on Shepard as ${dto.role}. Accept: ${acceptUrl}`,
        tags: [
          { name: 'kind', value: 'invitation' },
          { name: 'tenant_id', value: currentTenantId },
        ],
      });
    } catch (err: any) {
      this.logger.warn(`Invitation email send failed for ${dto.email}: ${err.message}`);
    }

    // Strip the secret token from the response in production.
    // In development, include it for testing without an email service.
    if (process.env.NODE_ENV === 'production') {
      const { token: _token, ...safeResponse } = saved;
      return safeResponse as Invitation;
    }
    return saved;
  }

  /**
   * Cancel a pending invitation (migration 100). Soft-cancel via
   * UPDATE cancelled_at = now() so the audit trail survives. The
   * accept flow gates on cancelled_at IS NULL, so cancelled invites
   * become unusable.
   *
   * admin/pastor only (RLS on invitations enforces tenant scoping at
   * the controller layer; this method just confirms the row exists
   * within the caller's tenant). Idempotent — re-cancelling a
   * cancelled invite is a no-op.
   */
  async cancelInvitation(invitationId: string, requestingUser: SupabaseJwtPayload): Promise<{ cancelled: true }> {
    const { queryRunner, currentTenantId } = this.getRlsContext();

    const [row] = await queryRunner.query(
      `SELECT id, email, role, accepted_at, cancelled_at
       FROM public.invitations
       WHERE id = $1 AND tenant_id = $2`,
      [invitationId, currentTenantId],
    );
    if (!row) throw new NotFoundException('Invitation not found');
    if (row.accepted_at) {
      throw new ConflictException('Cannot cancel an already-accepted invitation');
    }

    // Idempotent — if already cancelled, return success without re-writing.
    if (row.cancelled_at) return { cancelled: true };

    await queryRunner.query(
      `UPDATE public.invitations SET cancelled_at = now() WHERE id = $1`,
      [invitationId],
    );

    // Audit row so "we cancelled this person's invite" is in the trail.
    const [actor] = await queryRunner.query(
      `SELECT full_name FROM public.users WHERE id = $1`,
      [requestingUser.sub],
    );
    await this.audit.log({
      action: 'member.invitation_cancelled',
      resourceType: 'user',
      resourceId: invitationId,
      summary: `${actor?.full_name ?? 'Admin'} cancelled invitation to ${row.email}`,
      metadata: { invitationId, email: row.email, role: row.role },
    });

    this.logger.log(`Invitation ${invitationId} cancelled by ${requestingUser.sub}`);
    return { cancelled: true };
  }

  /**
   * Accepts an invitation by token.
   *
   * This is a service-role operation — the invitee does not yet have the
   * target tenant in their JWT context, so RLS would block any attempt to
   * read or write to that tenant's tables.
   *
   * Validations (all fatal — no partial acceptance):
   *   1. Token must exist.
   *   2. Invitation must not be already accepted.
   *   3. Invitation must not be expired (410 Gone).
   *   4. Authenticated user's email must match the invitation email.
   *
   * On success: creates the membership and marks the invitation accepted
   * in a single atomic transaction. The invitee must then call
   * POST /auth/switch-tenant + POST /auth/refresh to activate the new context.
   */
  async acceptInvitation(
    token: string,
    user: SupabaseJwtPayload,
  ): Promise<{ message: string; tenantId: string; role: string }> {
    // Service role: the invitee has no tenant context yet
    const invitation = await this.dataSource.manager.findOne(Invitation, {
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found or already used');
    }

    if (invitation.acceptedAt !== null) {
      throw new ConflictException('This invitation has already been accepted');
    }

    // Migration 100: cancelled invitations are unusable.
    if (invitation.cancelledAt !== null) {
      throw new GoneException(
        'This invitation was cancelled by an admin. Ask them to send a new one.',
      );
    }

    if (invitation.expiresAt < new Date()) {
      throw new GoneException(
        `This invitation expired at ${invitation.expiresAt.toISOString()}. ` +
          'Ask a tenant admin to send a new invitation.',
      );
    }

    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was not sent to your email address',
      );
    }

    await this.dataSource.transaction(async manager => {
      // Idempotency: if membership already exists, just mark the invitation accepted
      const existing = await manager.findOne(TenantMembership, {
        where: { userId: user.sub, tenantId: invitation.tenantId },
      });

      if (!existing) {
        await manager.save(
          TenantMembership,
          manager.create(TenantMembership, {
            userId: user.sub,
            tenantId: invitation.tenantId,
            role: invitation.role,
          }),
        );
      }

      await manager.update(Invitation, { id: invitation.id }, { acceptedAt: new Date() });
    });

    this.logger.log(
      `Invitation ${invitation.id} accepted by user ${user.sub} ` +
        `→ joined tenant ${invitation.tenantId} as '${invitation.role}'`,
    );

    return {
      message:
        'Invitation accepted. Call POST /api/auth/switch-tenant then POST /api/auth/refresh ' +
        'to activate your new church context.',
      tenantId: invitation.tenantId,
      role: invitation.role,
    };
  }

  /**
   * PUBLIC variant of acceptInvitation for brand-new invitees who
   * don't yet have a Shepard account. Validates the invitation token,
   * creates the Supabase auth user with the email locked to the
   * invitation's email (caller cannot redirect the invite to a
   * different address), accepts the membership, and returns Supabase
   * session tokens for an immediate logged-in state.
   *
   * SERVICE-ROLE per design: the invitee has no JWT yet, so we
   * can't use the request queryRunner. dataSource bypasses RLS;
   * tenant_id is taken from the trusted invitation row, never from
   * the request body.
   */
  async signupAndAcceptInvitation(
    token: string,
    dto: SignupAndAcceptInvitationDto,
  ): Promise<{
    user: { id: string; email: string };
    tenantId: string;
    role: string;
    session: { access_token: string; refresh_token: string; expires_at: number | null } | null;
  }> {
    // Look up invitation via service role (RLS bypass — invitee has no JWT).
    const invitation = await this.dataSource.manager.findOne(Invitation, {
      where: { token },
    });
    if (!invitation) throw new NotFoundException('Invitation not found or already used');
    if (invitation.acceptedAt !== null) {
      throw new ConflictException('This invitation has already been accepted');
    }
    if (invitation.cancelledAt !== null) {
      throw new GoneException('This invitation was cancelled by an admin.');
    }
    if (invitation.expiresAt < new Date()) {
      throw new GoneException('This invitation has expired. Ask for a new one.');
    }

    const inviteEmail = invitation.email.toLowerCase();

    // Reject if an auth user with this email already exists — they
    // should use POST /:token/accept after logging in instead. We
    // detect via direct SQL (NOT listUsers) — same pagination lesson
    // as completeSignup.
    const [existing] = await this.dataSource.query(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [inviteEmail],
    );
    if (existing) {
      throw new ConflictException(
        'An account with this email already exists. Log in and then accept the invitation.',
      );
    }

    // Create the Supabase auth user. email_confirm=true: paying invited
    // members shouldn't bounce through email confirmation since the
    // invite link IS the confirmation step.
    const fullName =
      dto.fullName?.trim() ||
      inviteEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const { data: createdUser, error: createErr } =
      await this.supabaseAdmin.client.auth.admin.createUser({
        email: inviteEmail,
        password: dto.password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          invited: true,
          invited_to_tenant_id: invitation.tenantId,
        },
        app_metadata: {
          current_tenant_id: invitation.tenantId,
        },
      });
    if (createErr || !createdUser?.user) {
      throw new InternalServerErrorException(
        `Failed to create account: ${createErr?.message ?? 'unknown error'}`,
      );
    }
    const newUserId = createdUser.user.id;

    // Materialize membership + accept the invitation, atomically.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO public.users (id, email, full_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(EXCLUDED.full_name, public.users.full_name)`,
        [newUserId, inviteEmail, fullName],
      );
      await manager.query(
        `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, permissions)
         VALUES ($1, $2, $3, '{}'::jsonb)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [invitation.tenantId, newUserId, invitation.role],
      );
      await manager.query(
        `UPDATE public.invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`,
        [invitation.id],
      );
    });

    // Sign the new user in immediately so the client can land logged-in.
    // signInWithPassword via the admin client returns tokens; we
    // expose the access/refresh pair to the caller.
    let session: { access_token: string; refresh_token: string; expires_at: number | null } | null = null;
    try {
      const { data: signedIn, error: signInErr } =
        await this.supabaseAdmin.client.auth.signInWithPassword({
          email: inviteEmail,
          password: dto.password,
        });
      if (signInErr) {
        this.logger.warn(`signupAndAcceptInvitation: post-create signIn failed for ${inviteEmail}: ${signInErr.message}`);
      } else if (signedIn?.session) {
        session = {
          access_token: signedIn.session.access_token,
          refresh_token: signedIn.session.refresh_token,
          expires_at: signedIn.session.expires_at ?? null,
        };
      }
    } catch (err: any) {
      this.logger.warn(`signupAndAcceptInvitation: signIn exception for ${inviteEmail}: ${err.message}`);
    }

    try {
      await this.audit.log({
        action: 'invitation.signed_up_and_accepted',
        resourceType: 'user',
        resourceId: invitation.id,
        targetUserId: newUserId,
        summary: `New account created from invitation for ${inviteEmail}`,
        metadata: {
          invitationId: invitation.id,
          email: inviteEmail,
          role: invitation.role,
          tenantId: invitation.tenantId,
        },
      });
    } catch (err: any) {
      this.logger.warn(`signupAndAcceptInvitation: audit log failed: ${err.message}`);
    }

    return {
      user: { id: newUserId, email: inviteEmail },
      tenantId: invitation.tenantId,
      role: invitation.role,
      session,
    };
  }

  private getRlsContext() {
    const context = rlsStorage.getStore();
    if (!context) {
      throw new InternalServerErrorException(
        'RLS context unavailable. Ensure RlsContextInterceptor is applied.',
      );
    }
    return context;
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
