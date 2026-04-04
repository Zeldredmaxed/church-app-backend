import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { TIER_FEATURE_KEY } from '../decorators/requires-tier.decorator';
import { SupabaseJwtPayload } from '../types/jwt-payload.type';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  TierFeatures,
  getTierFeatures,
  minimumTierForFeature,
  TIER_DISPLAY_NAMES,
  TierName,
} from '../config/tier-features.config';

/**
 * Guard that enforces tier-based feature gating.
 *
 * Must be applied AFTER JwtAuthGuard (needs request.user).
 *
 * Reads the @RequiresTier() decorator metadata to determine which features
 * are required, looks up the tenant's tier, and checks the feature config.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, TierGuard)
 *   @RequiresTier('videoUploads')
 */
@Injectable()
export class TierGuard implements CanActivate {
  private readonly logger = new Logger(TierGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeatures = this.reflector.getAllAndOverride<
      (keyof TierFeatures)[]
    >(TIER_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    // No @RequiresTier() decorator — allow access
    if (!requiredFeatures || requiredFeatures.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as SupabaseJwtPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const currentTenantId = user.app_metadata?.current_tenant_id;
    if (!currentTenantId) {
      throw new ForbiddenException(
        'No tenant context. Call POST /api/auth/switch-tenant first.',
      );
    }

    // Look up the tenant's tier
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: currentTenantId },
      select: ['id', 'tier'],
    });

    if (!tenant) {
      throw new ForbiddenException('Tenant not found');
    }

    const features = getTierFeatures(tenant.tier);

    // Check all required features
    for (const feature of requiredFeatures) {
      const value = features[feature];
      const isEnabled =
        value === true || (typeof value === 'number' && value !== 0 && value !== -0);

      if (!isEnabled) {
        const minTier = minimumTierForFeature(feature);
        const tierDisplay = TIER_DISPLAY_NAMES[minTier];
        const currentDisplay =
          TIER_DISPLAY_NAMES[tenant.tier as TierName] ?? tenant.tier;

        const featureLabel = feature
          .replace(/([A-Z])/g, ' $1')
          .toLowerCase()
          .trim();

        this.logger.warn(
          `Tier gate: ${featureLabel} blocked for tenant ${currentTenantId} ` +
            `(tier: ${tenant.tier}, requires: ${minTier})`,
        );

        throw new ForbiddenException(
          `${featureLabel.charAt(0).toUpperCase() + featureLabel.slice(1)} ` +
            `requires the ${tierDisplay} plan or higher. ` +
            `Your church is currently on the ${currentDisplay} plan.`,
        );
      }
    }

    return true;
  }
}
