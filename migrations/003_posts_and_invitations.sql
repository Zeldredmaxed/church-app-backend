-- =============================================================================
-- MIGRATION: 003_posts_and_invitations.sql
-- Phase 1, Week 3 — Posts table & Invitations table with RLS
--
-- Implements:
--   - public.posts       (internal church posts, Phase 1 — global posts are Phase 2)
--   - public.invitations (time-limited email invitations to join a tenant)
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1: POSTS TABLE
-- =============================================================================

CREATE TABLE public.posts (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id            UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    author_id            UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
    content              TEXT        NOT NULL,
    -- Populated by the Phase 2 Mux video pipeline. NULL = text/image post.
    video_mux_playback_id TEXT,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  public.posts                         IS 'Church-internal posts. tenant_id is always set (Phase 1). Global posts (tenant_id NULL) are Phase 2.';
COMMENT ON COLUMN public.posts.video_mux_playback_id   IS 'Mux playback ID — set by the video-processing BullMQ worker after transcoding completes.';
COMMENT ON COLUMN public.posts.tenant_id               IS 'NOT NULL in Phase 1. Phase 2 will allow NULL for global/public posts.';

-- Performance indexes — all RLS policies and feed queries hit these
CREATE INDEX idx_posts_tenant_id           ON public.posts (tenant_id);
CREATE INDEX idx_posts_author_id           ON public.posts (author_id);
CREATE INDEX idx_posts_tenant_created_desc ON public.posts (tenant_id, created_at DESC);

-- updated_at auto-maintenance trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_set_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- SECTION 2: INVITATIONS TABLE
-- =============================================================================

CREATE TABLE public.invitations (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    invited_by  UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
    email       TEXT        NOT NULL,
    role        TEXT        NOT NULL CHECK (role IN ('admin', 'pastor', 'member')),
    -- Cryptographically secure random hex token (32 bytes = 64 hex chars).
    -- Delivered exclusively via email in production.
    token       TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,           -- NULL = pending
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  public.invitations             IS 'Time-limited email invitations. One pending invitation per email per tenant.';
COMMENT ON COLUMN public.invitations.token       IS 'Secure random token — never returned in API responses (email-only). DEV ONLY: returned in response until email service is wired.';
COMMENT ON COLUMN public.invitations.accepted_at IS 'NULL = pending. Set to NOW() when the invitee calls POST /invitations/:token/accept.';

-- Prevent duplicate pending invitations for the same email+tenant.
-- An admin must delete (cancel) the existing invite before re-inviting.
CREATE UNIQUE INDEX idx_invitations_pending_per_email_tenant
  ON public.invitations (tenant_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE INDEX idx_invitations_token      ON public.invitations (token);
CREATE INDEX idx_invitations_tenant_id  ON public.invitations (tenant_id);


-- =============================================================================
-- SECTION 3: ROW-LEVEL SECURITY — POSTS
-- =============================================================================

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts FORCE ROW LEVEL SECURITY;

-- SELECT: any tenant member can read posts in their current tenant
CREATE POLICY "posts: select within current tenant"
  ON public.posts
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- INSERT: any tenant member can create a post, but:
--   1. tenant_id must match current context (cannot post into another tenant)
--   2. author_id must match the authenticated user (cannot impersonate another author)
CREATE POLICY "posts: insert by tenant member"
  ON public.posts
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.user_id   = auth.uid()
    )
  );

-- UPDATE: only the original author can edit their own post content
CREATE POLICY "posts: update by author only"
  ON public.posts
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
  )
  WITH CHECK (
    -- Prevent re-assigning a post to a different tenant or author via UPDATE
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND author_id = auth.uid()
  );

-- DELETE: author can delete their own post; tenant admin can delete any post
CREATE POLICY "posts: delete by author or admin"
  ON public.posts
  FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      author_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
          AND tm.user_id   = auth.uid()
          AND tm.role      = 'admin'
      )
    )
  );


-- =============================================================================
-- SECTION 4: ROW-LEVEL SECURITY — INVITATIONS
-- =============================================================================

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY;

-- SELECT: only admins and pastors can see invitations for their current tenant
CREATE POLICY "invitations: select by admin or pastor"
  ON public.invitations
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.user_id   = auth.uid()
        AND tm.role      IN ('admin', 'pastor')
    )
  );

-- INSERT: only admins and pastors; invited_by must match the caller
CREATE POLICY "invitations: insert by admin or pastor"
  ON public.invitations
  FOR INSERT
  WITH CHECK (
    tenant_id  = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.user_id   = auth.uid()
        AND tm.role      IN ('admin', 'pastor')
    )
  );

-- DELETE (cancel): only admins can cancel a pending invitation
CREATE POLICY "invitations: delete by admin"
  ON public.invitations
  FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND accepted_at IS NULL  -- Cannot cancel an already-accepted invitation
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.user_id   = auth.uid()
        AND tm.role      = 'admin'
    )
  );

-- NOTE: There is no UPDATE policy on invitations.
-- Marking an invitation as accepted is done by the acceptance service using
-- the service role (bypasses RLS). This prevents the invitee from setting
-- accepted_at to NULL to "recycle" a used invitation.


-- =============================================================================
-- SECTION 5: VERIFICATION QUERIES
-- =============================================================================

-- 5a. Confirm both tables exist
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('posts', 'invitations');

-- 5b. Confirm RLS is enabled and forced
-- SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename IN ('posts', 'invitations');

-- 5c. Confirm all 7 policies are installed
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('posts', 'invitations')
-- ORDER BY tablename, policyname;
-- Expected:
--   posts       | posts: delete by author or admin  | DELETE
--   posts       | posts: insert by tenant member    | INSERT
--   posts       | posts: select within current tenant | SELECT
--   posts       | posts: update by author only      | UPDATE
--   invitations | invitations: delete by admin      | DELETE
--   invitations | invitations: insert by admin or pastor | INSERT
--   invitations | invitations: select by admin or pastor | SELECT

-- 5d. Confirm unique index on pending invitations
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'invitations'
--   AND indexname = 'idx_invitations_pending_per_email_tenant';

COMMIT;
