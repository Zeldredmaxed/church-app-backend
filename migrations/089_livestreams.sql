-- Migration 089: LiveStream module
--
-- Backs the pastor-led live-broadcast feature. Pastors create a stream
-- (which provisions a Mux live stream + stream key for OBS) and viewers
-- watch the playback_id via HLS. Realtime chat alongside the player
-- reuses Supabase Realtime on channel `stream:<streamId>:chat` — no
-- backend table needed for chat messages.
--
-- mux_stream_key is the secret OBS uses to push RTMP — only the creator
-- (admin/pastor) should ever see it. The service layer enforces this:
-- GET endpoints never return it; only POST /api/streams returns it once.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.streams (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NULL,
  is_live             BOOLEAN NOT NULL DEFAULT false,
  mux_live_stream_id  TEXT NULL,
  mux_playback_id     TEXT NULL,
  mux_stream_key      TEXT NULL,
  thumbnail_url       TEXT NULL,
  viewer_count        INT NOT NULL DEFAULT 0,
  created_by          UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streams_tenant_starts_at
  ON public.streams(tenant_id, starts_at DESC);

-- Speed up GET /api/streams/current — partial index on the rare live rows.
CREATE INDEX IF NOT EXISTS idx_streams_tenant_live
  ON public.streams(tenant_id, starts_at DESC)
  WHERE is_live = true;

-- One-to-one mapping from Mux live stream id to our row so webhooks can
-- look us up cheaply. Partial unique so multiple NULLs are fine while
-- provisioning is in-flight.
CREATE UNIQUE INDEX IF NOT EXISTS streams_mux_live_stream_id_uidx
  ON public.streams (mux_live_stream_id)
  WHERE mux_live_stream_id IS NOT NULL;

ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read: anyone in the tenant can SELECT. Writes go through
-- the service layer (admins use the service-role-bypassed insert via
-- queryRunner under RLS; the RoleGuard limits POST to admin/pastor).
DROP POLICY IF EXISTS "streams: select within tenant" ON public.streams;
CREATE POLICY "streams: select within tenant"
  ON public.streams FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "streams: manage within tenant" ON public.streams;
CREATE POLICY "streams: manage within tenant"
  ON public.streams FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION public.streams_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS streams_touch_updated_at ON public.streams;
CREATE TRIGGER streams_touch_updated_at
  BEFORE UPDATE ON public.streams
  FOR EACH ROW EXECUTE FUNCTION public.streams_touch_updated_at();
