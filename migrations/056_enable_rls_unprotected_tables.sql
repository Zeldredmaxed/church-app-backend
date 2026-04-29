-- Migration 056: Enable RLS on tables flagged by the Supabase security advisor.
--
-- These tables were created with "RLS not needed — accessed via service role"
-- comments. That's true for the app's own service code (which uses the
-- service-role data source) but leaves the tables wide-open to anyone with an
-- authenticated JWT hitting the Supabase REST/GraphQL APIs directly.
--
-- The app continues to use the service-role connection, so RLS doesn't affect
-- existing flows — these policies are defense-in-depth.

-- ===========================================================================
-- onboarding_forms — tenant-scoped form definitions
-- ===========================================================================
ALTER TABLE public.onboarding_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_forms FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onboarding_forms: select within tenant" ON public.onboarding_forms;
CREATE POLICY "onboarding_forms: select within tenant"
  ON public.onboarding_forms FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "onboarding_forms: write by admin" ON public.onboarding_forms;
CREATE POLICY "onboarding_forms: write by admin"
  ON public.onboarding_forms FOR ALL
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = onboarding_forms.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  )
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = onboarding_forms.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  );

-- ===========================================================================
-- onboarding_responses — submitted member responses
-- (Not in the advisor list this round, but it sits in the same module and has
--  the same "no RLS needed" comment in 032 — fixing it here to avoid a repeat
--  finding next sweep.)
-- ===========================================================================
ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_responses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onboarding_responses: select own or admin" ON public.onboarding_responses;
CREATE POLICY "onboarding_responses: select own or admin"
  ON public.onboarding_responses FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      user_id = (auth.jwt() ->> 'sub')::uuid
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = onboarding_responses.tenant_id
          AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.role IN ('admin', 'pastor')
      )
    )
  );

DROP POLICY IF EXISTS "onboarding_responses: insert own" ON public.onboarding_responses;
CREATE POLICY "onboarding_responses: insert own"
  ON public.onboarding_responses FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "onboarding_responses: update own or admin" ON public.onboarding_responses;
CREATE POLICY "onboarding_responses: update own or admin"
  ON public.onboarding_responses FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      user_id = (auth.jwt() ->> 'sub')::uuid
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = onboarding_responses.tenant_id
          AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.role IN ('admin', 'pastor')
      )
    )
  );

DROP POLICY IF EXISTS "onboarding_responses: delete by admin" ON public.onboarding_responses;
CREATE POLICY "onboarding_responses: delete by admin"
  ON public.onboarding_responses FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = onboarding_responses.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  );

-- ===========================================================================
-- workflow_templates — public marketplace listings
-- Anyone authenticated can browse published templates; only the publisher can
-- modify their own. is_official can never be set/flipped via RLS — only the
-- service role (running platform seed scripts) can mark a template official.
-- ===========================================================================
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_templates: select published or own" ON public.workflow_templates;
CREATE POLICY "workflow_templates: select published or own"
  ON public.workflow_templates FOR SELECT
  USING (
    is_published = true
    OR publisher_user_id = (auth.jwt() ->> 'sub')::uuid
  );

DROP POLICY IF EXISTS "workflow_templates: insert by publisher" ON public.workflow_templates;
CREATE POLICY "workflow_templates: insert by publisher"
  ON public.workflow_templates FOR INSERT
  WITH CHECK (
    publisher_user_id = (auth.jwt() ->> 'sub')::uuid
    AND publisher_tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND is_official = false
  );

DROP POLICY IF EXISTS "workflow_templates: update own" ON public.workflow_templates;
CREATE POLICY "workflow_templates: update own"
  ON public.workflow_templates FOR UPDATE
  USING (publisher_user_id = (auth.jwt() ->> 'sub')::uuid)
  WITH CHECK (
    publisher_user_id = (auth.jwt() ->> 'sub')::uuid
    AND is_official = false
  );

DROP POLICY IF EXISTS "workflow_templates: delete own" ON public.workflow_templates;
CREATE POLICY "workflow_templates: delete own"
  ON public.workflow_templates FOR DELETE
  USING (publisher_user_id = (auth.jwt() ->> 'sub')::uuid);

-- ===========================================================================
-- workflow_template_installs — per-tenant install ledger
-- ===========================================================================
ALTER TABLE public.workflow_template_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_template_installs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_template_installs: select within tenant" ON public.workflow_template_installs;
CREATE POLICY "workflow_template_installs: select within tenant"
  ON public.workflow_template_installs FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "workflow_template_installs: insert own tenant" ON public.workflow_template_installs;
CREATE POLICY "workflow_template_installs: insert own tenant"
  ON public.workflow_template_installs FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND installed_by = (auth.jwt() ->> 'sub')::uuid
  );

DROP POLICY IF EXISTS "workflow_template_installs: delete own tenant" ON public.workflow_template_installs;
CREATE POLICY "workflow_template_installs: delete own tenant"
  ON public.workflow_template_installs FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- ===========================================================================
-- workflow_template_ratings — public ratings, per-tenant write
-- Ratings are public marketplace data (anyone can read), but each tenant can
-- only rate a template once and can only modify their own rating.
-- ===========================================================================
ALTER TABLE public.workflow_template_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_template_ratings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_template_ratings: select all" ON public.workflow_template_ratings;
CREATE POLICY "workflow_template_ratings: select all"
  ON public.workflow_template_ratings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "workflow_template_ratings: insert own tenant" ON public.workflow_template_ratings;
CREATE POLICY "workflow_template_ratings: insert own tenant"
  ON public.workflow_template_ratings FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "workflow_template_ratings: update own tenant" ON public.workflow_template_ratings;
CREATE POLICY "workflow_template_ratings: update own tenant"
  ON public.workflow_template_ratings FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "workflow_template_ratings: delete own tenant" ON public.workflow_template_ratings;
CREATE POLICY "workflow_template_ratings: delete own tenant"
  ON public.workflow_template_ratings FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
