BEGIN;

-- Audience segments
CREATE TABLE IF NOT EXISTS public.audience_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audience_segments_tenant ON public.audience_segments(tenant_id);

-- Message templates
CREATE TABLE IF NOT EXISTS public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'push')),
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_templates_tenant ON public.message_templates(tenant_id);

-- Sent messages history
CREATE TABLE IF NOT EXISTS public.sent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES public.audience_segments(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'scheduled', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sent_messages_tenant ON public.sent_messages(tenant_id, created_at DESC);

-- RLS
ALTER TABLE public.audience_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audience_segments: select within tenant" ON public.audience_segments;
CREATE POLICY "audience_segments: select within tenant" ON public.audience_segments
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "message_templates: select within tenant" ON public.message_templates;
CREATE POLICY "message_templates: select within tenant" ON public.message_templates
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS "sent_messages: select within tenant" ON public.sent_messages;
CREATE POLICY "sent_messages: select within tenant" ON public.sent_messages
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Sermon extensions
ALTER TABLE public.sermons ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.sermons ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.sermons ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.sermons ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sermon_likes (
  sermon_id UUID NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sermon_id, user_id)
);

ALTER TABLE public.sermon_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_likes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sermon_likes: select within tenant" ON public.sermon_likes;
CREATE POLICY "sermon_likes: select within tenant" ON public.sermon_likes
  FOR SELECT USING (
    sermon_id IN (SELECT id FROM public.sermons WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

COMMIT;
