BEGIN;

-- Badge definitions (created by pastors)
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT 'award',
  color TEXT NOT NULL DEFAULT '#6366f1',
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('giving', 'attendance', 'spiritual', 'service', 'engagement', 'custom')),
  auto_award_rule JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

-- Badge awards (which members have which badges)
CREATE TABLE IF NOT EXISTS public.member_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  awarded_reason TEXT,
  UNIQUE(badge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_badges_tenant ON public.badges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_user ON public.member_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_badge ON public.member_badges(badge_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_tenant ON public.member_badges(tenant_id);

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.member_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_badges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges: select within tenant" ON public.badges;
CREATE POLICY "badges: select within tenant" ON public.badges
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "member_badges: select within tenant" ON public.member_badges;
CREATE POLICY "member_badges: select within tenant" ON public.member_badges
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

COMMIT;
