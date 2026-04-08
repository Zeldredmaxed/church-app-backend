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
import { DataSource, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import { rlsStorage } from '../common/storage/rls.storage';
import { Invitation } from './entities/invitation.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';

const INVITATION_TTL_HOURS = 24;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns all pending (unaccepted) invitations for the current tenant.
   * Augments each with an isExpired flag so the UI can show stale invitations.
   * RLS SELECT policy enforces admin/pastor-only access.
   */
  async getInvitations(): Promise<Array<Invitation & { isExpired: boolean }>> {
    const { queryRunner } = this.getRlsContext();
    const now = new Date();

    const invitations = await queryRunner.manager.find(Invitation, {
      where: { acceptedAt: IsNull() },
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

    this.logger.log(
      `Invitation created: ${saved.id} for ${dto.email} in tenant ${currentTenantId}`,
    );

    // Phase 2 TODO: enqueue BullMQ 'notifications' job to send the invitation email.
    // The job should include: recipientEmail, invitationToken, tenantName, role, expiresAt.
    // The token must ONLY travel via email — remove it from the return value below.
    // await this.notificationsQueue.add('INVITATION_EMAIL', { token, email: dto.email, ... });

    // Strip the secret token from the response in production.
    // In development, include it for testing without an email service.
    if (process.env.NODE_ENV === 'production') {
      const { token: _token, ...safeResponse } = saved;
      return safeResponse as Invitation;
    }
    return saved;
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
