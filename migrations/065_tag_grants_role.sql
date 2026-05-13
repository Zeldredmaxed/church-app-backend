-- Migration 065: Tag-granted roles.
--
-- Lets a tag optionally grant a role in tenant_memberships when assigned,
-- and conditionally revoke it on removal. Schema-only here; the side-effects
-- are wired in the service layer.
--
-- Two table changes:
--   1. Expand the tenant_memberships role allow-list to include 'moderator'
--      (the new role that tags can grant). Existing rows untouched.
--   2. Add the grants_role column on tags, NULL by default.

-- ── tenant_memberships.role: add 'moderator' to the allow-list ──
ALTER TABLE public.tenant_memberships DROP CONSTRAINT IF EXISTS tenant_memberships_role_check;
ALTER TABLE public.tenant_memberships ADD CONSTRAINT tenant_memberships_role_check
  CHECK (role IN ('admin', 'pastor', 'moderator', 'accountant', 'worship_leader', 'member'));

-- ── tags.grants_role ──
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS grants_role TEXT
  CHECK (grants_role IS NULL OR grants_role IN ('admin', 'pastor', 'moderator'));

-- For removeTagFromMember: when checking 'does this user have another tag
-- granting the same role?', we filter member_tags by user_id then join to
-- tags by grants_role. The existing pk on (tag_id, user_id) already gives a
-- user_id index via reverse-lookup; explicit covering index helps the join.
CREATE INDEX IF NOT EXISTS idx_tags_grants_role
  ON public.tags (tenant_id, grants_role)
  WHERE grants_role IS NOT NULL;
