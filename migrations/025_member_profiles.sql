BEGIN;

-- Spiritual journey tracking per member per tenant
CREATE TABLE IF NOT EXISTS public.member_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attended_members_class BOOLEAN NOT NULL DEFAULT false,
  members_class_date DATE,
  is_baptized BOOLEAN NOT NULL DEFAULT false,
  baptism_date DATE,
  salvation_date DATE,
  discipleship_track TEXT,
  skills TEXT[],
  interests TEXT[],
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_journeys_tenant ON public.member_journeys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_member_journeys_user ON public.member_journeys(user_id);

ALTER TABLE public.member_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_journeys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_journeys: select within tenant" ON public.member_journeys;
CREATE POLICY "member_journeys: select within tenant" ON public.member_journeys
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Pastor notes on members (private, admin/pastor only)
CREATE TABLE IF NOT EXISTS public.member_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_notes_tenant_member ON public.member_notes(tenant_id, member_id, created_at DESC);

ALTER TABLE public.member_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_notes: select within tenant" ON public.member_notes;
CREATE POLICY "member_notes: select within tenant" ON public.member_notes
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

COMMIT;
