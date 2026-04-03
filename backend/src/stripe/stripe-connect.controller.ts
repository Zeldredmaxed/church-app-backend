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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { StripeService } from './stripe.service';
import { OnboardConnectDto } from './dto/onboard-connect.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { rlsStorage } from '../common/storage/rls.storage';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantMembership } from '../memberships/entities/tenant-membership.entity';

@ApiTags('Stripe Connect')
@ApiBearerAuth()
@Controller('stripe/connect')
@UseGuards(JwtAuthGuard)
@UseInterceptors(RlsContextInterceptor)
export class StripeConnectController {
  constructor(private readonly stripeService: StripeService) {}

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

    if (!stripeAccountId) {
      const account = await this.stripeService.createConnectAccount(tenant.name);
      stripeAccountId = account.id;

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
