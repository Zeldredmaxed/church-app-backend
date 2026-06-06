-- 076: Volunteer-hours verification + broadcast delivery history
--
-- Self-reported volunteer hours need an admin verification step before
-- they hit KPIs (501(c)(3) audit trail). NULL verified_by = pending;
-- non-NULL = verified.
--
-- broadcast_history captures every admin-fired notification broadcast
-- so the dashboard can show "you sent this; 412 of 800 phones got it."
-- Per-token Expo receipts are written by the processor as they come back.

ALTER TABLE public.volunteer_hours
  ADD COLUMN IF NOT EXISTS verified_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS verification_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_volunteer_hours_pending_verification
  ON public.volunteer_hours (tenant_id, created_at DESC)
  WHERE verified_by IS NULL;

CREATE TABLE IF NOT EXISTS public.broadcast_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sent_by         UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience_kind   TEXT NOT NULL DEFAULT 'all'
                  CHECK (audience_kind IN ('all', 'tag', 'role', 'segment', 'custom')),
  audience_value  TEXT NULL,
  audience_size   INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count    INT NOT NULL DEFAULT 0,
  read_count      INT NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_history_tenant_sent
  ON public.broadcast_history (tenant_id, sent_at DESC);

ALTER TABLE public.broadcast_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "broadcast_history: tenant scope" ON public.broadcast_history;
CREATE POLICY "broadcast_history: tenant scope"
  ON public.broadcast_history FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
