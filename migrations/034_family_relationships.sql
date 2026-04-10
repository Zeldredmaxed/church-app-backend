-- 034: Family Connections
-- Bidirectional family links between church members with request/accept flow
-- and auto-inference engine for in-laws, shared children, and siblings.

-- ── Table ──
CREATE TABLE IF NOT EXISTS public.family_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  related_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relationship      TEXT NOT NULL
                    CHECK (relationship IN (
                      'spouse','child','parent','sibling',
                      'grandparent','grandchild','uncle_aunt','nephew_niece','cousin',
                      'parent_in_law','child_in_law','sibling_in_law','cousin_in_law'
                    )),
  relationship_label VARCHAR(50) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined')),
  is_inferred       BOOLEAN NOT NULL DEFAULT false,
  inferred_via      UUID REFERENCES public.family_connections(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at       TIMESTAMPTZ
);

-- Unique: one relationship type per directed user pair per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_family_conn_pair'
  ) THEN
    ALTER TABLE public.family_connections
      ADD CONSTRAINT uq_family_conn_pair
      UNIQUE (tenant_id, user_id, related_user_id, relationship);
  END IF;
END $$;

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_family_conn_user
  ON public.family_connections (tenant_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_family_conn_related
  ON public.family_connections (tenant_id, related_user_id, status);

CREATE INDEX IF NOT EXISTS idx_family_conn_inferred_via
  ON public.family_connections (inferred_via)
  WHERE inferred_via IS NOT NULL;

-- ── RLS ──
ALTER TABLE public.family_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS family_conn_select ON public.family_connections;
DROP POLICY IF EXISTS family_conn_insert ON public.family_connections;
DROP POLICY IF EXISTS family_conn_update ON public.family_connections;
DROP POLICY IF EXISTS family_conn_delete ON public.family_connections;

CREATE POLICY family_conn_select ON public.family_connections
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

CREATE POLICY family_conn_insert ON public.family_connections
  FOR INSERT WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

CREATE POLICY family_conn_update ON public.family_connections
  FOR UPDATE USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      user_id = (auth.jwt() ->> 'sub')::uuid
      OR related_user_id = (auth.jwt() ->> 'sub')::uuid
    )
  );

CREATE POLICY family_conn_delete ON public.family_connections
  FOR DELETE USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      user_id = (auth.jwt() ->> 'sub')::uuid
      OR related_user_id = (auth.jwt() ->> 'sub')::uuid
    )
  );
