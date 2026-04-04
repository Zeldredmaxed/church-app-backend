import { SetMetadata } from '@nestjs/common';
import { TierFeatures } from '../config/tier-features.config';

/**
 * Decorator that gates a route behind a specific tier feature.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, TierGuard)
 *   @RequiresTier('videoUploads')
 *   @Post('presigned-url')
 *   getUploadUrl() { ... }
 *
 * The TierGuard will:
 *   1. Look up the tenant's tier from the database.
 *   2. Check if the required feature is enabled for that tier.
 *   3. Throw ForbiddenException with an upsell message if not.
 *
 * Multiple features can be specified (ALL must be enabled):
 *   @RequiresTier('chat', 'pushNotifications')
 */
export const TIER_FEATURE_KEY = 'requiredTierFeatures';
export const RequiresTier = (...features: (keyof TierFeatures)[]) =>
  SetMetadata(TIER_FEATURE_KEY, features);
