BEGIN;

-- Admin-level leaderboard toggle on tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS leaderboard_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.leaderboard_enabled IS
  'When false, all members are excluded from church AND global leaderboards. Controlled by admin only.';

COMMIT;
