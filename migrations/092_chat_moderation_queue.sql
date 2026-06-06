-- 092: Chat moderation queue + user mutes
--
-- chat_message_flags: end-user reports against a specific chat message.
-- Admins triage from /api/admin/chat-moderation/flags. status transitions:
--   open → dismissed (no action — false report or acceptable content)
--   open → removed   (admin deleted the underlying chat_messages row)
--
-- chat_user_mutes: time-bounded mute applied by an admin. ChatService
-- sendMessage refuses inserts when an unexpired mute row exists for
-- (tenant_id, user_id).
--
-- RLS: both tables are admin/service only — the public flag endpoint
-- (/api/chat/messages/:id/flag) inserts via the service-role / queryRunner
-- with explicit tenant pinning, and the admin endpoints run under the
-- RoleGuard. Tenant isolation is enforced in the application layer; we
-- still set ENABLE ROW LEVEL SECURITY so a stray client can't read them.

CREATE TABLE IF NOT EXISTS public.chat_message_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id   UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason       TEXT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CONSTRAINT chat_message_flags_status_chk
               CHECK (status IN ('open', 'dismissed', 'removed')),
  resolved_at  TIMESTAMPTZ NULL,
  resolved_by  UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_message_flags_tenant_status
  ON public.chat_message_flags (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_flags_message
  ON public.chat_message_flags (message_id);

-- Prevent the same reporter from flagging the same message twice while
-- the report is open. Once it's dismissed/removed they can re-report if
-- the content reappears, but we don't want spam-stacking the queue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_message_flags_open_per_reporter
  ON public.chat_message_flags (message_id, reporter_id)
  WHERE status = 'open';

ALTER TABLE public.chat_message_flags ENABLE ROW LEVEL SECURITY;

-- Deny-by-default RLS: only service_role (admin endpoints + the
-- queryRunner under RlsContextInterceptor running as authenticated) may
-- touch this table via the application layer. We don't expose SELECT to
-- the authenticated role — flags are admin-only data.
DROP POLICY IF EXISTS chat_message_flags_service_all ON public.chat_message_flags;
CREATE POLICY chat_message_flags_service_all ON public.chat_message_flags
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users may INSERT (file a flag) when reporter_id = auth.uid()
-- and the message belongs to a channel in their current tenant.
DROP POLICY IF EXISTS chat_message_flags_insert_self ON public.chat_message_flags;
CREATE POLICY chat_message_flags_insert_self ON public.chat_message_flags
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

CREATE TABLE IF NOT EXISTS public.chat_user_mutes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  muted_by    UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  reason      TEXT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_user_mutes_active
  ON public.chat_user_mutes (tenant_id, user_id, expires_at DESC);

ALTER TABLE public.chat_user_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_user_mutes_service_all ON public.chat_user_mutes;
CREATE POLICY chat_user_mutes_service_all ON public.chat_user_mutes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users may SELECT their own active mute (so the mobile
-- client can show "you're muted until X" without hitting an admin route).
DROP POLICY IF EXISTS chat_user_mutes_select_self ON public.chat_user_mutes;
CREATE POLICY chat_user_mutes_select_self ON public.chat_user_mutes
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );
