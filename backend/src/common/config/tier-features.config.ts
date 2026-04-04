/**
 * Tier Feature Configuration
 *
 * Single source of truth for what each tier can access.
 * The TierGuard and frontend bootstrap endpoint both read from this.
 *
 * Tier philosophy ("Grow with Us"):
 *   starter    → Admin-only. Digital filing cabinet. No mobile app.
 *   standard   → Core offering. Mobile app + basic community feed.
 *   pro        → Growth tools: video, chat, push, search, granular roles.
 *   enterprise → White-glove: custom branding, multi-site, API access.
 */

export type TierName = 'starter' | 'standard' | 'pro' | 'enterprise';

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

  // Enterprise extras
  customBranding: boolean;
  multiSite: boolean;
  apiAccess: boolean;
}

export const TIER_FEATURES: Record<TierName, TierFeatures> = {
  starter: {
    mobileApp: false,
    maxAdminUsers: 2,
    granularRoles: false,
    internalFeed: false,
    globalFeed: false,
    videoPostsAllowed: false,
    search: false,
    pushNotifications: false,
    pushNotificationsSegmented: false,
    chat: false,
    videoUploads: false,
    storageLimit: 0,
    transactionFeePercent: 2.0,
    customBranding: false,
    multiSite: false,
    apiAccess: false,
  },

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
    customBranding: false,
    multiSite: false,
    apiAccess: false,
  },

  pro: {
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
    customBranding: true,
    multiSite: true,
    apiAccess: true,
  },
};

/**
 * Returns the feature set for a given tier.
 * Falls back to 'starter' for unknown tier values.
 */
export function getTierFeatures(tier: string): TierFeatures {
  return TIER_FEATURES[tier as TierName] ?? TIER_FEATURES.starter;
}

/**
 * Human-readable tier names for error messages and UI.
 */
export const TIER_DISPLAY_NAMES: Record<TierName, string> = {
  starter: 'Starter',
  standard: 'Standard',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/**
 * Returns the minimum tier required for a given feature.
 * Used in upsell messages: "Video uploads require Pro tier or higher."
 */
export function minimumTierForFeature(feature: keyof TierFeatures): TierName {
  const tierOrder: TierName[] = ['starter', 'standard', 'pro', 'enterprise'];
  for (const tier of tierOrder) {
    const features = TIER_FEATURES[tier];
    const val = features[feature];
    if (val === true || (typeof val === 'number' && val !== 0)) {
      return tier;
    }
  }
  return 'enterprise';
}
