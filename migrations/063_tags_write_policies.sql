-- Migration 063: Add missing write policies for tags and member_tags.
--
-- Bug: POST /api/tags 500s with 'new row violates row-level security
-- policy for table "tags"'. The tables have RLS enabled + forced, but
-- only a SELECT policy existed — no INSERT/UPDATE/DELETE policies, so
-- every write through an authenticated JWT is rejected. The 6 existing
-- tags in the test tenant were seeded via the service role.
--
-- Adds INSERT/UPDATE/DELETE for tenant admin/pastor on both tables. The
-- controller's doc-comments already said "admin: manage_members"; this
-- enforces it at the DB layer regardless of guard presence.

-- ─── tags ───
DROP POLICY IF EXISTS "tags: insert by admin" ON public.tags;
CREATE POLICY "tags: insert by admin"
  ON public.tags FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = tags.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  );

DROP POLICY IF EXISTS "tags: update by admin" ON public.tags;
CREATE POLICY "tags: update by admin"
  ON public.tags FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = tags.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  )
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "tags: delete by admin" ON public.tags;
CREATE POLICY "tags: delete by admin"
  ON public.tags FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = tags.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  );

-- ─── member_tags ───
-- member_tags has no tenant_id column, so policies join to tags for the
-- tenant scope. tags SELECT RLS lets the admin see their tenant's tags,
-- so the inner SELECT resolves cleanly — no recursion risk because tags
-- never references member_tags.
DROP POLICY IF EXISTS "member_tags: insert by admin" ON public.member_tags;
CREATE POLICY "member_tags: insert by admin"
  ON public.member_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tags t
      JOIN public.tenant_memberships tm
        ON tm.tenant_id = t.tenant_id
       AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
       AND tm.role IN ('admin', 'pastor')
      WHERE t.id = member_tags.tag_id
        AND t.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  );

DROP POLICY IF EXISTS "member_tags: delete by admin" ON public.member_tags;
CREATE POLICY "member_tags: delete by admin"
  ON public.member_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.tags t
      JOIN public.tenant_memberships tm
        ON tm.tenant_id = t.tenant_id
       AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
       AND tm.role IN ('admin', 'pastor')
      WHERE t.id = member_tags.tag_id
        AND t.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  );
