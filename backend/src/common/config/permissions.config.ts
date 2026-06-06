/**
 * Canonical per-feature permission keys for staff/leader roles
 * (migration 100, per admin dashboard ticket).
 *
 * Used in two places:
 *   1. The admin UI populates the per-member permission grid from
 *      ALL_PERMISSIONS. Mobile/admin can fetch this list to render
 *      the matrix without hardcoding.
 *   2. The PermissionsGuard checks these keys on protected endpoints
 *      via @Permissions(...) (see permissions.decorator.ts).
 *
 * RULE: role 'admin' and 'pastor' BYPASS all permission checks (the
 * guard already enforces this). All other roles are gated by their
 * explicit keys in tenant_memberships.permissions JSONB.
 *
 * Notifications are intentionally NOT in this list — every staffer
 * gets their own notifications regardless of role, so there's no
 * `manage_notifications` key.
 */
export const ALL_PERMISSION_KEYS = [
  // People + groups
  'manage_members',
  'manage_groups',
  'manage_care',
  'manage_volunteers',
  'manage_onboarding',
  // Finance + commerce
  'manage_finance',
  'view_reports',
  'manage_fundraisers',
  'manage_shop',
  // Engagement
  'manage_events',
  'manage_attendance',
  'manage_checkin',
  'manage_tasks',
  'manage_communications',
  'manage_challenges',
  'manage_badges',
  'manage_leaderboard',
  'manage_sermons',
  'manage_streams',
  // Operations
  'manage_facilities',
  'manage_campuses',
  'manage_workflows',
  // Safety + governance
  'manage_moderation',
  'manage_chat_moderation',
  'view_audit_log',
  'manage_gdpr',
  // Settings
  'manage_settings',
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/**
 * Human-readable labels for each permission key. Mobile/admin can use
 * these to render the permission matrix UI without hardcoding strings.
 */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  manage_members: 'Manage members',
  manage_groups: 'Manage groups',
  manage_care: 'Manage care cases',
  manage_volunteers: 'Manage volunteers',
  manage_onboarding: 'Configure onboarding',
  manage_finance: 'Manage finance + giving',
  view_reports: 'View reports',
  manage_fundraisers: 'Manage fundraisers',
  manage_shop: 'Manage shop',
  manage_events: 'Manage events',
  manage_attendance: 'Manage attendance',
  manage_checkin: 'Manage check-in',
  manage_tasks: 'Manage tasks',
  manage_communications: 'Send communications',
  manage_challenges: 'Manage Faith Walks / challenges',
  manage_badges: 'Manage badges',
  manage_leaderboard: 'Manage leaderboard',
  manage_sermons: 'Manage sermons',
  manage_streams: 'Manage live streams',
  manage_facilities: 'Manage facilities',
  manage_campuses: 'Manage campuses',
  manage_workflows: 'Manage workflows',
  manage_moderation: 'Moderate posts + content',
  manage_chat_moderation: 'Moderate chat',
  view_audit_log: 'View audit log',
  manage_gdpr: 'Process GDPR requests',
  manage_settings: 'Edit church settings',
};
