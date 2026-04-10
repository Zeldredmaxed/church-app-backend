-- 038: Child Check-in Safety Features
-- Adds secure child check-in with guardian linking, security codes,
-- and medical/allergy alerts for children's ministry.

-- ── Medical/Allergy Alerts ──
CREATE TABLE IF NOT EXISTS public.member_medical_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL CHECK (alert_type IN ('allergy', 'medical', 'dietary', 'behavioral', 'other')),
  description TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_by  UUID NOT NULL REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_alerts_user
  ON public.member_medical_alerts (tenant_id, user_id);

ALTER TABLE public.member_medical_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medical_alerts_select ON public.member_medical_alerts;
CREATE POLICY medical_alerts_select ON public.member_medical_alerts
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS medical_alerts_insert ON public.member_medical_alerts;
CREATE POLICY medical_alerts_insert ON public.member_medical_alerts
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS medical_alerts_update ON public.member_medical_alerts;
CREATE POLICY medical_alerts_update ON public.member_medical_alerts
  FOR UPDATE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS medical_alerts_delete ON public.member_medical_alerts;
CREATE POLICY medical_alerts_delete ON public.member_medical_alerts
  FOR DELETE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- ── Child check-in extensions ──
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS guardian_id UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS security_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS label_printed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS child_name TEXT;

CREATE INDEX IF NOT EXISTS idx_checkins_security_code
  ON public.check_ins (tenant_id, security_code)
  WHERE security_code IS NOT NULL;

-- ── Authorized pickups (who can pick up a child besides their guardian) ──
CREATE TABLE IF NOT EXISTS public.authorized_pickups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  child_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pickup_name TEXT NOT NULL,
  relationship TEXT,
  photo_url   TEXT,
  created_by  UUID NOT NULL REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_authorized_pickups
  ON public.authorized_pickups (tenant_id, child_id);

ALTER TABLE public.authorized_pickups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pickups_select ON public.authorized_pickups;
CREATE POLICY pickups_select ON public.authorized_pickups
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS pickups_insert ON public.authorized_pickups;
CREATE POLICY pickups_insert ON public.authorized_pickups
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS pickups_delete ON public.authorized_pickups;
CREATE POLICY pickups_delete ON public.authorized_pickups
  FOR DELETE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);
