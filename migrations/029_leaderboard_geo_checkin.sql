BEGIN;

-- Leaderboard visibility settings per user
CREATE TABLE IF NOT EXISTS public.leaderboard_settings (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Geo check-in configuration per tenant
CREATE TABLE IF NOT EXISTS public.checkin_config (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  day_of_week INTEGER NOT NULL DEFAULT 0 CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '12:00',
  latitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  longitude DOUBLE PRECISION NOT NULL DEFAULT 0,
  radius_meters INTEGER NOT NULL DEFAULT 800,
  push_message TEXT NOT NULL DEFAULT 'Good morning! Tap to check in to today''s service.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Geo check-in log (extends existing check_ins table)
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION;
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS check_in_type TEXT NOT NULL DEFAULT 'manual' CHECK (check_in_type IN ('manual', 'geo', 'admin'));

-- App open tracking for "check_ins" leaderboard category (daily active)
CREATE TABLE IF NOT EXISTS public.daily_app_opens (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  open_date DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, tenant_id, open_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_app_opens_tenant ON public.daily_app_opens(tenant_id, open_date);

ALTER TABLE public.leaderboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.daily_app_opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_app_opens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leaderboard_settings: select own" ON public.leaderboard_settings;
CREATE POLICY "leaderboard_settings: select own" ON public.leaderboard_settings
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "checkin_config: select within tenant" ON public.checkin_config;
CREATE POLICY "checkin_config: select within tenant" ON public.checkin_config
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "daily_app_opens: select within tenant" ON public.daily_app_opens;
CREATE POLICY "daily_app_opens: select within tenant" ON public.daily_app_opens
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

COMMIT;
