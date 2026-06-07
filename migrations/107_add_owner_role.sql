-- 107: Add 'owner' role — the church account holder
--
-- Slack/Stripe/GitHub-style "Owner" tier above admin. The person
-- who pays for and founds the church account. Single owner per
-- tenant (board-led churches assign owner to the board's
-- representative; pastor-led churches assign to the pastor).
--
-- Properties enforced in code:
--   - Always has all permissions (PermissionsGuard auto-passes)
--   - Auto-passes RoleGuard regardless of @RequiresRole(...) list
--     (owner is implicitly above every other role)
--   - Cannot be demoted (enforced at the membership-update endpoint)
--   - Transferable via dedicated endpoint (future — not in this push)
--
-- Founding admins from completeSignup will be inserted with this
-- role starting now. Existing 'admin' rows that semantically should
-- be 'owner' (currently only Zel's row from his launch-morning
-- signup) are patched in-flight via SQL.

ALTER TABLE public.tenant_memberships DROP CONSTRAINT IF EXISTS tenant_memberships_role_check;
ALTER TABLE public.tenant_memberships ADD CONSTRAINT tenant_memberships_role_check
  CHECK (role IN ('owner', 'admin', 'pastor', 'moderator', 'accountant', 'worship_leader', 'member'));

-- Enforce ≤1 owner per tenant. Partial unique index — only one row
-- per tenant_id may have role='owner'. Doesn't constrain other
-- roles (a tenant can have many admins, many members, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_owner_per_tenant
  ON public.tenant_memberships (tenant_id)
  WHERE role = 'owner';
