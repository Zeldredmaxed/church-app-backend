-- Migration 091: AI Assistant conversations + messages
-- Persists multi-turn AI Assistant chats so admins can return to past sessions.
-- Premium-tier gated (enforced in service layer via @RequiresTier('aiAssistant')).

-- 1. ai_conversations
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation' CHECK (char_length(title) <= 200),
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON public.ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conv_tenant ON public.ai_conversations(tenant_id);

-- 2. ai_messages
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tokens_input INT,
  tokens_output INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON public.ai_messages(conversation_id, created_at ASC);

-- 3. RLS — owner-only read/write. Tenant is enforced via the join through ai_conversations.
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_conversations: own only" ON public.ai_conversations;
CREATE POLICY "ai_conversations: own only"
  ON public.ai_conversations FOR ALL
  USING (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  )
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "ai_messages: own conversations" ON public.ai_messages;
CREATE POLICY "ai_messages: own conversations"
  ON public.ai_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND c.user_id = auth.uid()
        AND c.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND c.user_id = auth.uid()
        AND c.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  );
