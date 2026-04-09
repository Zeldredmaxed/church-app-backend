BEGIN;

-- User settings (notification preferences)
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  push_notifications BOOLEAN NOT NULL DEFAULT true,
  sms_notifications BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings: select own" ON public.user_settings;
CREATE POLICY "user_settings: select own" ON public.user_settings
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "user_settings: upsert own" ON public.user_settings;
CREATE POLICY "user_settings: upsert own" ON public.user_settings
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "user_settings: update own" ON public.user_settings;
CREATE POLICY "user_settings: update own" ON public.user_settings
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub')::uuid);

-- Login streaks
CREATE TABLE IF NOT EXISTS public.login_streaks (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 1,
  longest_streak INTEGER NOT NULL DEFAULT 1,
  last_login_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.login_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_streaks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_streaks: select own" ON public.login_streaks;
CREATE POLICY "login_streaks: select own" ON public.login_streaks
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);

-- Giving funds table
CREATE TABLE IF NOT EXISTS public.giving_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_giving_funds_tenant ON public.giving_funds(tenant_id);

ALTER TABLE public.giving_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giving_funds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "giving_funds: select within tenant" ON public.giving_funds;
CREATE POLICY "giving_funds: select within tenant" ON public.giving_funds
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Add fund_id to transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS fund_id UUID REFERENCES public.giving_funds(id) ON DELETE SET NULL;

-- Volunteer hours tracking
CREATE TABLE IF NOT EXISTS public.volunteer_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.volunteer_opportunities(id) ON DELETE SET NULL,
  hours DECIMAL(5,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_volunteer_hours_tenant ON public.volunteer_hours(tenant_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_hours_user ON public.volunteer_hours(user_id);

ALTER TABLE public.volunteer_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_hours FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "volunteer_hours: select within tenant" ON public.volunteer_hours;
CREATE POLICY "volunteer_hours: select within tenant" ON public.volunteer_hours
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Attendance: add visitor tracking
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS is_visitor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS visitor_name TEXT;

-- Allow null user_id for visitor check-ins
ALTER TABLE public.check_ins ALTER COLUMN user_id DROP NOT NULL;

-- All services table: expand beyond just current day
CREATE INDEX IF NOT EXISTS idx_services_tenant ON public.services(tenant_id);

COMMIT;
