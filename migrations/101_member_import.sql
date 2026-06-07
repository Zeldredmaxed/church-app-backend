-- 101: Member CSV import (Tithely/Breeze migration path)
--
-- Pastors transitioning from Tithely/Breeze/ChurchTeams drag-drop a
-- CSV export and we populate profiles. No invitations are sent at
-- import time — the pastor controls timing via workflows (typically
-- the "Imported Members - Pending Invite" tag triggers a custom or
-- marketplace-installed welcome workflow).
--
-- Schema:
--   1. tenant_memberships.imported_at  — non-null = "joined via CSV import"
--   2. tenant_memberships.import_batch — UUID grouping all members from
--      ONE upload; lets the admin filter / undo a botched import
--   3. member_imports                  — audit + summary per upload
--
-- Note: imported members get an auth.users row (FK from public.users
-- requires it), but with email_confirm=false and no password. They
-- CAN'T log in. The state is "shadow profile" until they accept an
-- invitation, at which point they set a password and email-confirm
-- as a normal Supabase user. No magic-link, no welcome email, no
-- notifications fire on import — the workflow owns timing.

ALTER TABLE public.tenant_memberships
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS import_batch UUID NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_import_batch
  ON public.tenant_memberships (import_batch)
  WHERE import_batch IS NOT NULL;

-- One row per import upload. Lets admin see history + audit.
CREATE TABLE IF NOT EXISTS public.member_imports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  imported_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  source       TEXT NOT NULL CHECK (source IN ('tithely', 'breeze', 'churchteams', 'planning_center', 'generic')),
  filename     TEXT NULL,
  total_rows   INT NOT NULL DEFAULT 0,
  created_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  error_count   INT NOT NULL DEFAULT 0,
  errors_jsonb  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_imports_tenant_created
  ON public.member_imports (tenant_id, created_at DESC);

ALTER TABLE public.member_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_imports: select within tenant" ON public.member_imports;
CREATE POLICY "member_imports: select within tenant"
  ON public.member_imports FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Track that a "system" tag exists for imported-pending-invite members.
-- The workflow trigger 'member_tagged' on this tag is how pastors hook
-- their invitation flow (whether custom-built or marketplace-installed).
-- The tag itself is created lazily by the import service on first use
-- per tenant (so existing tenants don't get a forced new tag).
