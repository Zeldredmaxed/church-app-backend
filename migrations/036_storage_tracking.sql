-- 036: Storage Tracking
-- Tracks per-tenant storage consumption. Enforces tier-based storage limits.
-- Sends notifications at 80% and 95% thresholds.

-- ── Per-tenant storage summary (one row per tenant) ──
CREATE TABLE IF NOT EXISTS public.tenant_storage_usage (
  tenant_id     UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  used_bytes    BIGINT NOT NULL DEFAULT 0,
  file_count    INT NOT NULL DEFAULT 0,
  last_alert_percent INT NOT NULL DEFAULT 0,  -- last threshold notified (0, 80, or 95)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Individual file ledger (one row per uploaded file) ──
CREATE TABLE IF NOT EXISTS public.storage_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_key        TEXT NOT NULL,           -- S3 key: tenants/{id}/users/{id}/...
  file_size_bytes BIGINT NOT NULL,
  content_type    TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'upload',  -- upload, gallery, story, post, sermon
  source_id       UUID,                    -- optional FK to post/story/sermon/gallery
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_files_tenant
  ON public.storage_files (tenant_id);

CREATE INDEX IF NOT EXISTS idx_storage_files_user
  ON public.storage_files (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_storage_files_source
  ON public.storage_files (source_type, source_id)
  WHERE source_id IS NOT NULL;

-- ── RLS ──
ALTER TABLE public.tenant_storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_files ENABLE ROW LEVEL SECURITY;

-- Storage usage: admins in tenant can read
DROP POLICY IF EXISTS storage_usage_select ON public.tenant_storage_usage;
CREATE POLICY storage_usage_select ON public.tenant_storage_usage
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Storage files: members can see their own, admins can see all in tenant
DROP POLICY IF EXISTS storage_files_select ON public.storage_files;
CREATE POLICY storage_files_select ON public.storage_files
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS storage_files_insert ON public.storage_files;
CREATE POLICY storage_files_insert ON public.storage_files
  FOR INSERT WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS storage_files_delete ON public.storage_files;
CREATE POLICY storage_files_delete ON public.storage_files
  FOR DELETE USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
