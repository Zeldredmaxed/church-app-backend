-- =============================================================================
-- Migration 018: Member Tags
--
-- Adds tag definitions per tenant and many-to-many member-tag assignments.
-- =============================================================================

BEGIN;

-- ============================================================================
-- TAGS (tag definitions owned by each church/tenant)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_tenant ON public.tags (tenant_id);

-- ============================================================================
-- MEMBER_TAGS (many-to-many assignment of tags to members)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.member_tags (
  tag_id      UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_tags_user ON public.member_tags (user_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_tag  ON public.member_tags (tag_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.member_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags: select within tenant" ON public.tags;
CREATE POLICY "tags: select within tenant" ON public.tags
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "member_tags: select within tenant" ON public.member_tags;
CREATE POLICY "member_tags: select within tenant" ON public.member_tags
  FOR SELECT USING (
    tag_id IN (SELECT id FROM public.tags WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

COMMIT;
