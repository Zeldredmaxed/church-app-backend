-- 080: Automated geo-attendance system
--
-- Replaces the single-weekly-slot model in migration 029 with a
-- multi-service schedule + per-occurrence ping log + computed
-- attendance status with late/early-leave flags.
--
-- Existing public.services (from migration 017) already has
-- (name, day_of_week, start_time). We ALTER to add the geo + window
-- + threshold columns.
--
-- New tables:
--   service_occurrences — actual instances generated nightly (allows
--                         holiday cancellations)
--   attendance_pings    — multi-ping log per user per occurrence
--   service_attendance  — final computed status per user per occurrence
--                         with was_late + left_early flags
--   attendance_opt_in   — per (user, tenant) opt-in record; no opt-in
--                         means no pings recorded for that pair

-- ─── Extend existing services table ─────────────────────────────────
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS end_time TIME NULL,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS radius_meters INT NULL,
  ADD COLUMN IF NOT EXISTS late_threshold_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS early_leave_threshold_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_push_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_radius_chk') THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_radius_chk CHECK (radius_meters IS NULL OR (radius_meters BETWEEN 50 AND 5000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_late_chk') THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_late_chk CHECK (late_threshold_minutes BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_early_chk') THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_early_chk CHECK (early_leave_threshold_minutes BETWEEN 0 AND 120);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_services_tenant_active
  ON public.services (tenant_id) WHERE is_active = true;

-- ─── Service occurrences ────────────────────────────────────────────
-- Generated nightly for the next 30 days. occurrence_date is the date
-- in the tenant's timezone; starts_at/ends_at are full UTC timestamps
-- so the cron can compare directly against now().
CREATE TABLE IF NOT EXISTS public.service_occurrences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  is_cancelled    BOOLEAN NOT NULL DEFAULT false,
  cancelled_at    TIMESTAMPTZ NULL,
  cancelled_by    UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  start_push_sent_at TIMESTAMPTZ NULL,
  swept_at        TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_service_occ_tenant_starts
  ON public.service_occurrences (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_service_occ_pending_push
  ON public.service_occurrences (starts_at)
  WHERE start_push_sent_at IS NULL AND is_cancelled = false;
CREATE INDEX IF NOT EXISTS idx_service_occ_pending_sweep
  ON public.service_occurrences (ends_at)
  WHERE swept_at IS NULL AND is_cancelled = false;

ALTER TABLE public.service_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_occurrences: select within tenant" ON public.service_occurrences;
CREATE POLICY "service_occurrences: select within tenant" ON public.service_occurrences
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- ─── Attendance pings ───────────────────────────────────────────────
-- One row per location update from the mobile. Even pings outside any
-- service window are recorded (so we have data if the user complains
-- "I was there!") — service_occurrence_id is NULL for those.
CREATE TABLE IF NOT EXISTS public.attendance_pings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_occurrence_id UUID NULL REFERENCES public.service_occurrences(id) ON DELETE CASCADE,
  latitude              DOUBLE PRECISION NOT NULL,
  longitude             DOUBLE PRECISION NOT NULL,
  accuracy_meters       DOUBLE PRECISION NULL,
  distance_meters       DOUBLE PRECISION NULL,
  in_radius             BOOLEAN NOT NULL DEFAULT false,
  source                TEXT NOT NULL DEFAULT 'background'
                          CHECK (source IN ('background', 'geofence_entry', 'geofence_exit', 'foreground', 'auto_push_reply')),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_pings_user_recorded
  ON public.attendance_pings (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_pings_occurrence_user
  ON public.attendance_pings (service_occurrence_id, user_id)
  WHERE service_occurrence_id IS NOT NULL;

ALTER TABLE public.attendance_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_pings: select own" ON public.attendance_pings;
CREATE POLICY "attendance_pings: select own" ON public.attendance_pings
  FOR SELECT USING (user_id = auth.uid());

-- ─── Service attendance (computed) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_attendance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_occurrence_id UUID NOT NULL REFERENCES public.service_occurrences(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status                TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  was_late              BOOLEAN NOT NULL DEFAULT false,
  left_early            BOOLEAN NOT NULL DEFAULT false,
  first_in_radius_at    TIMESTAMPTZ NULL,
  last_in_radius_at     TIMESTAMPTZ NULL,
  ping_count            INT NOT NULL DEFAULT 0,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_occurrence_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_service_attendance_occ
  ON public.service_attendance (service_occurrence_id);
CREATE INDEX IF NOT EXISTS idx_service_attendance_tenant_user
  ON public.service_attendance (tenant_id, user_id);

ALTER TABLE public.service_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_attendance: select own" ON public.service_attendance;
CREATE POLICY "service_attendance: select own" ON public.service_attendance
  FOR SELECT USING (user_id = auth.uid());

-- ─── Per-(user, tenant) opt-in ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_opt_in (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opted_in     BOOLEAN NOT NULL DEFAULT false,
  opted_in_at  TIMESTAMPTZ NULL,
  opted_out_at TIMESTAMPTZ NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_opt_in_tenant_opted
  ON public.attendance_opt_in (tenant_id) WHERE opted_in = true;

ALTER TABLE public.attendance_opt_in ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_opt_in: manage own" ON public.attendance_opt_in;
CREATE POLICY "attendance_opt_in: manage own" ON public.attendance_opt_in
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
