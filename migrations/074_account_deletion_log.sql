-- 074: GDPR Art. 30 account-deletion audit log
--
-- Once a user calls DELETE /api/users/me, their public.users row is
-- gone — so we can't keep the audit on it via FK. account_deletion_log
-- preserves enough metadata (no PII beyond email + tenants affected at
-- time of deletion) for a compliance officer to answer "show me every
-- erasure request from the last 12 months."
--
-- email is the only identifier the user is likely to remember in a
-- follow-up. We keep it; the data subject can already request it be
-- removed via a separate ticket once the deletion is confirmed.

CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,                 -- no FK — user row is gone
  email        TEXT NOT NULL,
  full_name    TEXT NULL,
  tenant_ids   UUID[] NOT NULL DEFAULT '{}',  -- tenants this user was a member of at deletion time
  ip_address   INET NULL,
  user_agent   TEXT NULL,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_deleted_at
  ON public.account_deletion_log (deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_log_email
  ON public.account_deletion_log (lower(email));

-- Tenant array search for "deletions in my church"
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_tenant_ids
  ON public.account_deletion_log USING gin (tenant_ids);

ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;

-- Service-role only. The endpoint that reads this is RoleGuard'd at
-- the controller; we don't expose it through RLS to non-super-admins.
-- (Admins read via /api/admin/account-deletions which uses dataSource.)
DROP POLICY IF EXISTS "account_deletion_log: no public access" ON public.account_deletion_log;
CREATE POLICY "account_deletion_log: no public access"
  ON public.account_deletion_log FOR ALL
  USING (false);
