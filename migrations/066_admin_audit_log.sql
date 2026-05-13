-- Migration 066: Admin Audit Log.
--
-- Every action an admin takes generates one row. Read-only history.
-- Tenant admins/pastors can read; nobody can edit or delete.
--
-- Note on the INSERT policy:
-- The original spec said "no INSERT policy for authenticated users —
-- writes only via service role." That's safe against forgery but means
-- the audit insert can't live in the same transaction as the underlying
-- mutation (service-role writes use a separate pool connection). The
-- spec also requires "audit insert in the same transaction as the
-- mutation — failure rolls back."
--
-- We resolve in favor of the transactional guarantee with a NARROW
-- INSERT policy: authenticated callers can only insert rows where they
-- are the actor and the tenant matches their current_tenant_id. Forgery
-- is impossible (actor_user_id pinned to auth.uid()); audit insert can
-- run on the request's queryRunner connection inside the open
-- transaction; if it fails the whole mutation rolls back.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id   UUID NOT NULL REFERENCES public.users(id),
  -- Snapshot of the actor's role at the moment of action — reading the
  -- log 6 months later tells the truth even if their role changed since.
  actor_role      TEXT NOT NULL,
  -- Dotted key, e.g. 'member.blocked', 'tag.created', 'finance.refund_issued'.
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     UUID,
  -- Convenience for "what's been done to this person?" lookups.
  target_user_id  UUID,
  summary         TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the four common query shapes.
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created
  ON public.admin_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created
  ON public.admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_created
  ON public.admin_audit_log (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_action_created
  ON public.admin_audit_log (action, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;

-- SELECT: tenant admin/pastor only.
DROP POLICY IF EXISTS "audit_log: select admin" ON public.admin_audit_log;
CREATE POLICY "audit_log: select admin"
  ON public.admin_audit_log FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = (auth.jwt() ->> 'sub')::uuid
        AND m.tenant_id = admin_audit_log.tenant_id
        AND m.role IN ('admin', 'pastor')
    )
  );

-- INSERT: authenticated callers acting as themselves, in their own tenant.
-- Forgery impossible — actor_user_id pinned to auth.uid().
DROP POLICY IF EXISTS "audit_log: insert own" ON public.admin_audit_log;
CREATE POLICY "audit_log: insert own"
  ON public.admin_audit_log FOR INSERT
  WITH CHECK (
    actor_user_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- No UPDATE or DELETE policies — the log is immutable. Compliance
-- semantics: even tenant admins cannot edit or remove entries. If
-- retention ever requires aging out, do it as a service-role job.
