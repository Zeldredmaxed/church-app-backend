/**
 * Tier Feature Configuration
 *
 * Single source of truth for what each tier can access.
 * The TierGuard and frontend bootstrap endpoint both read from this.
 *
 * Tier names MUST match the CHECK constraint in migration 012:
 *   CHECK (tier IN ('standard', 'premium', 'enterprise'))
 *
 * Tier philosophy ("Grow with Us"):
 *   standard   → Core offering. Mobile app + basic community feed.
 *   premium    → Growth tools: video, chat, push, search, granular roles.
 *   enterprise → White-glove: custom branding, multi-site, API access.
 */

export type TierName = 'standard' | 'premium' | 'enterprise';

export interface TierFeatures {
  // Platform access
  mobileApp: boolean;

  // Admin limits
  maxAdminUsers: number; // -1 = unlimited

  // Granular admin roles (accountant, worship_leader, etc.)
  granularRoles: boolean;

  // Community & Feed
  internalFeed: boolean;
  globalFeed: boolean;
  videoPostsAllowed: boolean;
  search: boolean;

  // Communication
  pushNotifications: boolean;
  pushNotificationsSegmented: boolean;
  chat: boolean;

  // Media & Storage
  videoUploads: boolean;
  storageLimit: number; // in GB, -1 = unlimited/custom

  // Giving
  transactionFeePercent: number;

  // AI
  aiAssistant: boolean;

  // Enterprise extras
  customBranding: boolean;
  multiSite: boolean;
  apiAccess: boolean;
}

export const TIER_FEATURES: Record<TierName, TierFeatures> = {
  standard: {
    mobileApp: true,
    maxAdminUsers: 5,
    granularRoles: false,
    internalFeed: true,
    globalFeed: true,
    videoPostsAllowed: false,
    search: false,
    pushNotifications: false,
    pushNotificationsSegmented: false,
    chat: false,
    videoUploads: false,
    storageLimit: 10,
    transactionFeePercent: 1.0,
    aiAssistant: false,
    customBranding: false,
    multiSite: false,
    apiAccess: false,
  },

  premium: {
    mobileApp: true,
    maxAdminUsers: -1,
    granularRoles: true,
    internalFeed: true,
    globalFeed: true,
    videoPostsAllowed: true,
    search: true,
    pushNotifications: true,
    pushNotificationsSegmented: false,
    chat: true,
    videoUploads: true,
    storageLimit: 100,
    transactionFeePercent: 0.5,
    aiAssistant: true,
    customBranding: false,
    multiSite: false,
    apiAccess: false,
  },

  enterprise: {
    mobileApp: true,
    maxAdminUsers: -1,
    granularRoles: true,
    internalFeed: true,
    globalFeed: true,
    videoPostsAllowed: true,
    search: true,
    pushNotifications: true,
    pushNotificationsSegmented: true,
    chat: true,
    videoUploads: true,
    storageLimit: -1,
    transactionFeePercent: 0,
    aiAssistant: true,
    customBranding: true,
    multiSite: true,
    apiAccess: true,
  },
};

/**
 * Returns the feature set for a given tier.
 * Falls back to 'standard' for unknown tier values.
 */
export function getTierFeatures(tier: string): TierFeatures {
  return TIER_FEATURES[tier as TierName] ?? TIER_FEATURES.standard;
}

/**
 * Human-readable tier names for error messages and UI.
 */
export const TIER_DISPLAY_NAMES: Record<TierName, string> = {
  standard: 'Standard',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

/**
 * Returns the minimum tier required for a given feature.
 * Used in upsell messages: "Video uploads require Pro tier or higher."
 */
export function minimumTierForFeature(feature: keyof TierFeatures): TierName {
  const tierOrder: TierName[] = ['standard', 'premium', 'enterprise'];
  for (const tier of tierOrder) {
    const features = TIER_FEATURES[tier];
    const val = features[feature];
    if (val === true || (typeof val === 'number' && val !== 0)) {
      return tier;
    }
  }
  return 'enterprise';
}
