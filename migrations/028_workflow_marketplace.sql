-- 028: Workflow Marketplace (Node Store) — template publishing, installs, and ratings
-- Idempotent: safe to re-run

BEGIN;

-- Published workflow templates (the marketplace listings)
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who published it (null = platform-official template)
  publisher_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  publisher_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Template content
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT[] DEFAULT '{}',

  -- The workflow definition (nodes + connections as JSON)
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  nodes JSONB NOT NULL DEFAULT '[]',
  connections JSONB NOT NULL DEFAULT '[]',

  -- Marketplace info
  price_cents INTEGER NOT NULL DEFAULT 0,  -- 0 = free, 200 = $2.00
  currency TEXT NOT NULL DEFAULT 'usd',
  is_official BOOLEAN NOT NULL DEFAULT false,  -- true = platform templates
  is_published BOOLEAN NOT NULL DEFAULT true,
  install_count INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template purchases/installs
CREATE TABLE IF NOT EXISTS public.workflow_template_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  installed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,  -- in cents
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, tenant_id)
);

-- Template ratings
CREATE TABLE IF NOT EXISTS public.workflow_template_ratings (
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON public.workflow_templates(category, is_published);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_official ON public.workflow_templates(is_official) WHERE is_official = true;
CREATE INDEX IF NOT EXISTS idx_workflow_template_installs_tenant ON public.workflow_template_installs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_template_installs_template ON public.workflow_template_installs(template_id);

-- No RLS on marketplace tables — they're public listings
-- Access control is handled at the service level

COMMIT;
