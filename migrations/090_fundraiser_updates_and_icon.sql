-- Migration 090: Fundraiser updates feed + optional icon column
-- Adds:
--   1. Optional `icon` text column on fundraisers (Ionicon name; null => mobile picks default by category)
--   2. `fundraiser_updates` table — admin/author-authored progress posts attached to a fundraiser
--      Mobile renders these on the fundraiser detail screen below the cover image.

-- 1. Optional icon column on fundraisers
ALTER TABLE public.fundraisers
  ADD COLUMN IF NOT EXISTS icon TEXT;

-- 2. fundraiser_updates table
CREATE TABLE IF NOT EXISTS public.fundraiser_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id UUID NOT NULL REFERENCES public.fundraisers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  posted_by UUID NOT NULL REFERENCES public.users(id),
  content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundraiser_updates_fundraiser
  ON public.fundraiser_updates(fundraiser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fundraiser_updates_tenant
  ON public.fundraiser_updates(tenant_id);

-- 3. RLS — readable by anyone in the same tenant; writable by author or any tenant admin/pastor.
ALTER TABLE public.fundraiser_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fundraiser_updates: select within tenant" ON public.fundraiser_updates;
CREATE POLICY "fundraiser_updates: select within tenant"
  ON public.fundraiser_updates FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "fundraiser_updates: insert within tenant" ON public.fundraiser_updates;
CREATE POLICY "fundraiser_updates: insert within tenant"
  ON public.fundraiser_updates FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND posted_by = auth.uid()
  );

DROP POLICY IF EXISTS "fundraiser_updates: update own" ON public.fundraiser_updates;
CREATE POLICY "fundraiser_updates: update own"
  ON public.fundraiser_updates FOR UPDATE
  USING (posted_by = auth.uid());

DROP POLICY IF EXISTS "fundraiser_updates: delete own" ON public.fundraiser_updates;
CREATE POLICY "fundraiser_updates: delete own"
  ON public.fundraiser_updates FOR DELETE
  USING (posted_by = auth.uid());
