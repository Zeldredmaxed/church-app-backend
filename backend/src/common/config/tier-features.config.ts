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
 *   standard   → Core social platform. Feed + chat + push — the essentials
 *                every church needs to function as a community.
 *   premium    → Growth tools: video, segmented push, search, granular roles,
 *                AI Assistant, larger storage.
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

  // Workflows
  workflows: boolean;
  maxWorkflows: number;     // -1 = unlimited
  maxWorkflowNodes: number; // -1 = unlimited

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
    // Chat and push moved to Standard — a social platform without the ability
    // to message or receive notifications is not usable as a community app.
    // Segmented push (audience-targeted broadcasts) stays Premium.
    pushNotifications: true,
    pushNotificationsSegmented: false,
    chat: true,
    videoUploads: false,
    storageLimit: 10,
    transactionFeePercent: 1.3,
    aiAssistant: false,
    workflows: true,
    maxWorkflows: 1,
    maxWorkflowNodes: 5,
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
    transactionFeePercent: 1.0,
    aiAssistant: true,
    workflows: true,
    maxWorkflows: 1,
    maxWorkflowNodes: 5,
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
    transactionFeePercent: 0.5,
    aiAssistant: true,
    workflows: true,
    maxWorkflows: -1,
    maxWorkflowNodes: -1,
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
 * Monthly subscription price in USD cents. Single source of truth for
 * Stripe Checkout (plan upgrade) and any future Billing Portal /
 * pricing-page rendering. Standard is included for completeness even
 * though it isn't upgrade-able from anywhere (it's the entry tier).
 */
export const TIER_MONTHLY_PRICE_CENTS: Record<TierName, number> = {
  standard: 3900,
  premium: 9900,
  enterprise: 24900,
};

/**
 * Yearly subscription price = ×12 monthly (full sticker price).
 * The 2-months-free promo is now a USER-ENTERED coupon (e.g.
 * `ANNUAL-2FREE` at ~16.67% off) advertised via a banner on the
 * pricing page — opt-in, not auto-applied. Promo codes are
 * re-enabled on yearly checkout.
 */
export const TIER_YEARLY_PRICE_CENTS: Record<TierName, number> = {
  standard: 46800,    // $468/yr  ($39 × 12)
  premium: 118800,    // $1,188/yr ($99 × 12)
  enterprise: 298800, // $2,988/yr ($249 × 12)
};

/**
 * Ordinal rank used by upgrade-flow code to refuse downgrades and
 * already-on-tier requests. Higher number = higher tier.
 */
export function getTierLevel(tier: string): number {
  switch (tier) {
    case 'standard': return 1;
    case 'premium': return 2;
    case 'enterprise': return 3;
    default: return 0;
  }
}

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
