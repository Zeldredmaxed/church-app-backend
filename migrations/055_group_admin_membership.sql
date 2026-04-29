-- Migration 055: Admin-managed group membership + join requests.
--
-- Two related changes:
--   1. group_members INSERT policy now allows tenant admins/pastors and the
--      group creator to add other users — not just the user themselves.
--   2. New group_join_requests table for the request → admin-review flow.
--
-- Context: group joins were open (any tenant member could self-add via
--   POST /groups/:id/join). The new model makes join requests admin-gated:
--   non-members request access, admins approve or deny, admins can also
--   add members directly.

-- ---------------------------------------------------------------------------
-- 1. Loosen group_members INSERT to allow admin/creator-of-group to add others
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "group_members: insert own" ON public.group_members;
DROP POLICY IF EXISTS "group_members: insert" ON public.group_members;
CREATE POLICY "group_members: insert"
  ON public.group_members FOR INSERT
  WITH CHECK (
    -- Self-add (legacy behavior, preserved)
    user_id = (auth.jwt() ->> 'sub')::uuid
    -- Tenant admin/pastor adding any user in their tenant's group
    OR EXISTS (
      SELECT 1
      FROM public.groups g
      JOIN public.tenant_memberships tm ON tm.tenant_id = g.tenant_id
      WHERE g.id = group_members.group_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
    -- Group creator adding any user
    OR EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_members.group_id
        AND g.created_by = (auth.jwt() ->> 'sub')::uuid
    )
  );

-- Mirror the policy on DELETE so admins can remove members too. The legacy
-- policy only allowed self-removal (leaveGroup), which is still preserved.
DROP POLICY IF EXISTS "group_members: delete own" ON public.group_members;
DROP POLICY IF EXISTS "group_members: delete" ON public.group_members;
CREATE POLICY "group_members: delete"
  ON public.group_members FOR DELETE
  USING (
    user_id = (auth.jwt() ->> 'sub')::uuid
    OR EXISTS (
      SELECT 1
      FROM public.groups g
      JOIN public.tenant_memberships tm ON tm.tenant_id = g.tenant_id
      WHERE g.id = group_members.group_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
    OR EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_members.group_id
        AND g.created_by = (auth.jwt() ->> 'sub')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- 2. group_join_requests table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Denormalized for RLS — avoids a JOIN to groups in every policy check
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'denied')),
  message       TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES public.users(id),
  denied_reason TEXT
);

-- A user can only have one pending request per group at a time.
-- Once a request is resolved (approved/denied), they can request again.
CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_pending_uniq
  ON public.group_join_requests (group_id, user_id)
  WHERE status = 'pending';

-- For admin "show me pending requests for group X" queries.
CREATE INDEX IF NOT EXISTS idx_group_join_requests_group_status
  ON public.group_join_requests (group_id, status);

-- For "show me my requests" lookups.
CREATE INDEX IF NOT EXISTS idx_group_join_requests_user
  ON public.group_join_requests (user_id, status);

ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests FORCE ROW LEVEL SECURITY;

-- SELECT: requester sees their own requests. Tenant admin/pastor and the
-- group creator see all requests for groups they manage.
DROP POLICY IF EXISTS "group_join_requests: select" ON public.group_join_requests;
CREATE POLICY "group_join_requests: select"
  ON public.group_join_requests FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      user_id = (auth.jwt() ->> 'sub')::uuid
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = group_join_requests.tenant_id
          AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.role IN ('admin', 'pastor')
      )
      OR EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = group_join_requests.group_id
          AND g.created_by = (auth.jwt() ->> 'sub')::uuid
      )
    )
  );

-- INSERT: only the user can create a request for themselves, in their own tenant.
DROP POLICY IF EXISTS "group_join_requests: insert own" ON public.group_join_requests;
CREATE POLICY "group_join_requests: insert own"
  ON public.group_join_requests FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- UPDATE: admin/pastor or group creator can review (approve/deny).
DROP POLICY IF EXISTS "group_join_requests: update by admin" ON public.group_join_requests;
CREATE POLICY "group_join_requests: update by admin"
  ON public.group_join_requests FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = group_join_requests.tenant_id
          AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.role IN ('admin', 'pastor')
      )
      OR EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = group_join_requests.group_id
          AND g.created_by = (auth.jwt() ->> 'sub')::uuid
      )
    )
  );

-- DELETE: requester can withdraw their own pending request.
DROP POLICY IF EXISTS "group_join_requests: delete own" ON public.group_join_requests;
CREATE POLICY "group_join_requests: delete own"
  ON public.group_join_requests FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub')::uuid);
