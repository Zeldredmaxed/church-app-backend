-- Migration 039: Multi-Site / Multi-Campus Support
-- Allows a parent church organization to have multiple campus locations.
-- Each campus is its own tenant linked to a parent via parent_tenant_id.
-- Enterprise tier only (enforced by application-level TierGuard).

-- 1. Add multi-site columns to tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS campus_name      TEXT,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT,
  ADD COLUMN IF NOT EXISTS state            TEXT,
  ADD COLUMN IF NOT EXISTS zip              TEXT,
  ADD COLUMN IF NOT EXISTS latitude         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS feed_isolation   BOOLEAN DEFAULT false;

-- feed_isolation: when TRUE, each campus feed is isolated.
-- when FALSE (default), congregation sees posts from all sibling campuses.

COMMENT ON COLUMN public.tenants.parent_tenant_id IS 'If set, this tenant is a campus under the parent organization';
COMMENT ON COLUMN public.tenants.campus_name IS 'Display name for this campus location (e.g. "10th Street Campus")';
COMMENT ON COLUMN public.tenants.feed_isolation IS 'When true, social feed is isolated per campus. When false, shared across all campuses.';

-- 2. Index for fast campus lookups
CREATE INDEX IF NOT EXISTS idx_tenants_parent_tenant_id ON public.tenants (parent_tenant_id)
  WHERE parent_tenant_id IS NOT NULL;

-- 3. Prevent circular references: a parent cannot itself have a parent (max 1 level deep)
-- This keeps the model simple: Organization → Campuses (no deeper nesting).
ALTER TABLE public.tenants
  ADD CONSTRAINT chk_no_nested_campuses
  CHECK (
    -- Either this tenant has no parent (it's a standalone or parent org)
    -- The actual logic preventing nested campuses is enforced at the application layer.
    -- This check prevents a tenant from being its own parent.
    parent_tenant_id IS DISTINCT FROM id
  );

-- 4. Helper function: get all tenant IDs in an organization (parent + siblings)
CREATE OR REPLACE FUNCTION public.get_org_tenant_ids(p_tenant_id UUID)
RETURNS UUID[] AS $$
DECLARE
  v_parent_id UUID;
  v_result UUID[];
BEGIN
  -- Find the parent (or self if already a parent)
  SELECT COALESCE(parent_tenant_id, id) INTO v_parent_id
  FROM public.tenants WHERE id = p_tenant_id;

  IF v_parent_id IS NULL THEN
    RETURN ARRAY[p_tenant_id];
  END IF;

  -- Get the parent + all campuses
  SELECT array_agg(id) INTO v_result
  FROM public.tenants
  WHERE id = v_parent_id OR parent_tenant_id = v_parent_id;

  RETURN COALESCE(v_result, ARRAY[p_tenant_id]);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 5. Helper function: check if feed is isolated for a tenant's org
CREATE OR REPLACE FUNCTION public.is_feed_isolated(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_parent_id UUID;
  v_isolated BOOLEAN;
BEGIN
  SELECT COALESCE(parent_tenant_id, id) INTO v_parent_id
  FROM public.tenants WHERE id = p_tenant_id;

  SELECT feed_isolation INTO v_isolated
  FROM public.tenants WHERE id = v_parent_id;

  RETURN COALESCE(v_isolated, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
