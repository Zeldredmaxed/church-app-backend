import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { StripeService } from './stripe.service';
import { OnboardConnectDto } from './dto/onboard-connect.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseJwtPayload } from '../common/types/jwt-payload.type';
import { rlsStorage } from '../common/storage/rls.storage';
import { AuditService } from '../audit/audit.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';

@ApiTags('Stripe Connect')
@ApiBearerAuth()
@Controller('stripe/connect')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class StripeConnectController {
  private readonly logger = new Logger(StripeConnectController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Post('onboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate Stripe Connect onboarding (admin only, idempotent)' })
  @ApiResponse({ status: 200, description: 'Returns Stripe AccountLink URL and stripeAccountId' })
  @ApiResponse({ status: 400, description: 'Not an admin or no tenant context' })
  async onboard(@Body() dto: OnboardConnectDto) {
    const { queryRunner, userId, currentTenantId } = rlsStorage.getStore()!;

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context');
    }

    await this.requireAdmin(queryRunner, userId, currentTenantId);

    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    let stripeAccountId = tenant.stripeAccountId;
    let createdAccount = false;

    if (!stripeAccountId) {
      const account = await this.stripeService.createConnectAccount(tenant.name);
      stripeAccountId = account.id;
      createdAccount = true;

      await queryRunner.manager.update(Tenant, { id: currentTenantId }, {
        stripeAccountId: account.id,
        stripeAccountStatus: 'onboarding',
      });
    }

    const accountLink = await this.stripeService.createAccountLink(
      stripeAccountId,
      dto.refreshUrl,
      dto.returnUrl,
    );

    // Only audit the moment of Stripe account creation — not every onboard
    // link refresh. The audit row marks "this church connected Stripe."
    if (createdAccount) {
      const [actor] = await queryRunner.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
      await this.audit.log({
        action: 'finance.stripe_connected',
        resourceType: 'church',
        resourceId: currentTenantId,
        summary: `${actor?.full_name ?? 'Admin'} initiated Stripe Connect onboarding for "${tenant.name}"`,
        metadata: { stripeAccountId, churchName: tenant.name },
      });
    }

    return {
      url: accountLink.url,
      stripeAccountId,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get Stripe Connect onboarding status (admin only)' })
  @ApiResponse({ status: 200, description: 'Returns status, chargesEnabled, payoutsEnabled, detailsSubmitted' })
  @ApiResponse({ status: 400, description: 'Not an admin or no tenant context' })
  async getStatus() {
    const { queryRunner, userId, currentTenantId } = rlsStorage.getStore()!;

    if (!currentTenantId) {
      throw new BadRequestException('No active tenant context');
    }

    await this.requireAdmin(queryRunner, userId, currentTenantId);

    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    if (!tenant.stripeAccountId) {
      return {
        status: 'pending',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
    }

    const account = await this.stripeService.getAccount(tenant.stripeAccountId);

    let status = tenant.stripeAccountStatus;
    if (account.charges_enabled && account.details_submitted) {
      status = 'active';
    } else if (account.details_submitted) {
      status = 'restricted';
    } else {
      status = 'onboarding';
    }

    if (status !== tenant.stripeAccountStatus) {
      await queryRunner.manager.update(Tenant, { id: currentTenantId }, {
        stripeAccountStatus: status,
      });
    }

    return {
      status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  @Get('health')
  @ApiOperation({
    summary: 'Connect account health (balance, payouts, requirements) — admin/accountant',
    description:
      'Returns charges_enabled / payouts_enabled / outstanding requirements / available balance / last 10 payouts. Used by the admin dashboard hero card to alert when the account is restricted.',
  })
  @ApiResponse({ status: 200, description: 'Connect health payload' })
  @ApiResponse({ status: 400, description: 'No Connect account / no tenant context' })
  async getHealth() {
    const { queryRunner, userId, currentTenantId } = rlsStorage.getStore()!;
    if (!currentTenantId) throw new BadRequestException('No active tenant context');
    await this.requireAdmin(queryRunner, userId, currentTenantId);

    const tenant = await queryRunner.manager.findOne(Tenant, {
      where: { id: currentTenantId },
    });
    if (!tenant?.stripeAccountId) {
      throw new BadRequestException('This church has not started Stripe Connect onboarding');
    }

    const [account, balance, payouts] = await Promise.all([
      this.stripeService.retrieveConnectAccount(tenant.stripeAccountId),
      this.stripeService.getConnectBalance(tenant.stripeAccountId),
      this.stripeService.listConnectPayouts(tenant.stripeAccountId, 10),
    ]);

    return {
      account: {
        id: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirements: {
          currentlyDue: account.requirements?.currently_due ?? [],
          eventuallyDue: account.requirements?.eventually_due ?? [],
          pastDue: account.requirements?.past_due ?? [],
          disabledReason: account.requirements?.disabled_reason ?? null,
        },
      },
      balance: {
        available: balance.available.map(b => ({
          amount: b.amount,
          currency: b.currency,
        })),
        pending: balance.pending.map(b => ({
          amount: b.amount,
          currency: b.currency,
        })),
      },
      recentPayouts: payouts.data.map(p => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: p.arrival_date,
      })),
    };
  }

  /**
   * Creates a Stripe SetupIntent for saving a payment method.
   *
   * Lazily creates a Stripe Customer on first call — the customer ID is
   * stored on public.users.stripe_customer_id and reused thereafter.
   *
   * Saved cards are user-global (not tenant-scoped) — a card saved here
   * works for donations to any church the user belongs to.
   *
   * Does NOT require RLS/tenant context — only a valid JWT.
   */
  @Post('setup-intent')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a Stripe SetupIntent for saving a payment method' })
  @ApiResponse({ status: 201, description: '{ clientSecret }' })
  @ApiResponse({ status: 400, description: 'Stripe not configured' })
  async createSetupIntent(
    @CurrentUser() jwtUser: SupabaseJwtPayload,
  ): Promise<{ clientSecret: string }> {
    // Use service-role DataSource — no tenant context needed
    const user = await this.dataSource.manager.findOne(User, {
      where: { id: jwtUser.sub },
      select: ['id', 'email', 'fullName', 'stripeCustomerId'],
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripeService.createCustomer(
        user.email,
        user.fullName ?? undefined,
      );
      customerId = customer.id;

      await this.dataSource.manager.update(
        User,
        { id: user.id },
        { stripeCustomerId: customerId },
      );

      this.logger.log(`Stripe Customer created: ${customerId} for user ${user.id}`);
    }

    const setupIntent = await this.stripeService.createSetupIntent(customerId);

    if (!setupIntent.client_secret) {
      throw new BadRequestException('Unable to set up payment method. Please try again.');
    }
    return { clientSecret: setupIntent.client_secret };
  }

  private async requireAdmin(
    queryRunner: any,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const membership = await queryRunner.manager.findOne(TenantMembership, {
      where: { userId, tenantId },
    });

    if (!membership || membership.role !== 'admin') {
      throw new BadRequestException(
        'Only tenant admins can manage Stripe Connect',
      );
    }
  }
}
