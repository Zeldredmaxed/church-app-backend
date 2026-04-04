import { Injectable, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  TierFeatures,
  getTierFeatures,
  minimumTierForFeature,
  TIER_DISPLAY_NAMES,
  TierName,
} from '../config/tier-features.config';

/**
 * Injectable service for programmatic tier checks.
 *
 * Use this when the tier gate depends on runtime values (e.g., the content type
 * of an upload) rather than being a blanket route-level restriction.
 *
 * For route-level gating, prefer @RequiresTier() + TierGuard.
 */
@Injectable()
export class TierCheckService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns the feature set for a tenant.
   * Throws if the tenant doesn't exist.
   */
  async getFeaturesForTenant(tenantId: string): Promise<TierFeatures & { tier: string }> {
    const tenant = await this.dataSource.manager.findOne(Tenant, {
      where: { id: tenantId },
      select: ['id', 'tier'],
    });

    if (!tenant) {
      throw new ForbiddenException('Tenant not found');
    }

    return { ...getTierFeatures(tenant.tier), tier: tenant.tier };
  }

  /**
   * Asserts that a feature is enabled for the given tenant.
   * Throws ForbiddenException with an upsell message if not.
   */
  async requireFeature(tenantId: string, feature: keyof TierFeatures): Promise<void> {
    const features = await this.getFeaturesForTenant(tenantId);
    const value = features[feature];
    const isEnabled =
      value === true || (typeof value === 'number' && value !== 0);

    if (!isEnabled) {
      const minTier = minimumTierForFeature(feature);
      const tierDisplay = TIER_DISPLAY_NAMES[minTier];
      const currentDisplay =
        TIER_DISPLAY_NAMES[features.tier as TierName] ?? features.tier;

      const featureLabel = feature
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .trim();

      throw new ForbiddenException(
        `${featureLabel.charAt(0).toUpperCase() + featureLabel.slice(1)} ` +
          `requires the ${tierDisplay} plan or higher. ` +
          `Your church is currently on the ${currentDisplay} plan.`,
      );
    }
  }
}
