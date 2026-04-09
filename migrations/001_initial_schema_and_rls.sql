-- =============================================================================
-- MIGRATION: 001_initial_schema_and_rls.sql
-- Phase 1, Week 1 — Core Multi-Tenant Schema & RLS Infrastructure
--
-- Implements: Architecture Document § 3, Decision 1 (Auth & Multi-Tenant RLS)
--
-- Execution order matters. Run as a single transaction.
-- Tested against: Supabase (PostgreSQL 15+)
--
-- TESTING RLS LOCALLY (run in psql / Supabase SQL editor):
--   SET LOCAL request.jwt.claims = '{"app_metadata": {"current_tenant_id": "<uuid>"}}';
--   SET LOCAL role = 'authenticated';
--   SELECT * FROM public.tenants; -- Should return 0 or 1 row
--   RESET role;
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1: EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================================
-- SECTION 2: CORE SCHEMA  (Decision 1a — The Schema Foundation)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2a. Tenants (Churches)
-- Each row represents one church / organisation on the platform.
-- stripe_account_id is populated during Stripe Connect onboarding (Phase 3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT        NOT NULL,
    stripe_account_id TEXT,                          -- Nullable until onboarding
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  public.tenants                    IS 'One row per church / organisation (tenant).';
COMMENT ON COLUMN public.tenants.stripe_account_id  IS 'Stripe Connected Account ID — populated during Phase 3 onboarding.';

-- -----------------------------------------------------------------------------
-- 2b. Users (public profile — bridges auth.users to application data)
--
-- id is a foreign key to auth.users (Supabase-managed). Using ON DELETE CASCADE
-- means deleting a user from Supabase Auth automatically removes their public
-- profile and, by extension, all their tenant_memberships (see 2c below).
--
-- last_accessed_tenant_id is the "current context" column. It is the single
-- source of truth that the auth sync trigger (Section 4) reads to inject
-- current_tenant_id into the JWT. NULL = user has no active tenant yet.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id                      UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email                   TEXT        NOT NULL UNIQUE,
    last_accessed_tenant_id UUID        REFERENCES public.tenants(id) ON DELETE SET NULL,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  public.users                          IS 'Public user profile. Linked 1:1 to auth.users via id.';
COMMENT ON COLUMN public.users.last_accessed_tenant_id  IS 'The tenant the user is currently viewing. Drives JWT current_tenant_id claim via trigger.';

-- -----------------------------------------------------------------------------
-- 2c. Tenant Memberships (many-to-many: users ↔ tenants)
--
-- A user can belong to multiple churches (e.g. guest speaker, denominational
-- staff). This table records each membership and the user's role within it.
--
-- Both FKs cascade on delete:
--   - Deleting a user removes all their memberships.
--   - Deleting a tenant removes all its memberships.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
    user_id   UUID  NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
    tenant_id UUID  NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role      TEXT  NOT NULL CHECK (role IN ('admin', 'pastor', 'member')),
    PRIMARY KEY (user_id, tenant_id)
);

COMMENT ON TABLE  public.tenant_memberships          IS 'Many-to-many: users belong to tenants with a role in each.';
COMMENT ON COLUMN public.tenant_memberships.role     IS 'admin: full control | pastor: content + member mgmt | member: read/participate';


-- =============================================================================
-- SECTION 3: PERFORMANCE INDEXES
-- These indexes are load-bearing for RLS policy subqueries. Without them,
-- every authenticated request triggers sequential scans on tenant_memberships.
-- =============================================================================

-- Speeds up: "which memberships belong to this tenant?" (used by SELECT/INSERT/UPDATE/DELETE policies)
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON public.tenant_memberships (tenant_id);

-- Speeds up: "which tenants does this user belong to?" (used by users SELECT policy)
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id   ON public.tenant_memberships (user_id);

-- Speeds up: lookups by the context-switch trigger and FK integrity checks
CREATE INDEX IF NOT EXISTS idx_users_last_accessed_tenant   ON public.users (last_accessed_tenant_id);


-- =============================================================================
-- SECTION 4: NEW USER BOOTSTRAP TRIGGER
--
-- When a user signs up via Supabase Auth, this trigger auto-creates their
-- public.users profile row. This is a prerequisite for all RLS policies —
-- auth.uid() must resolve to a row in public.users.
--
-- Note: last_accessed_tenant_id starts NULL. The user will not pass RLS on
-- any tenant-scoped table until a platform admin assigns them a membership and
-- the backend calls POST /api/auth/switch-tenant to set their context.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER                          -- Bypasses RLS to write to public.users
SET search_path = public                  -- Prevents search_path hijacking
AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;          -- Idempotent: safe to replay
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS
    'Auto-creates a public.users profile on Supabase Auth sign-up. Required for RLS resolution.';


-- =============================================================================
-- SECTION 5: AUTH SYNC TRIGGER  (Decision 1b — The Auth Sync Trigger)
--
-- When a user switches their active church context (last_accessed_tenant_id
-- is updated via POST /api/auth/switch-tenant), this trigger syncs the new
-- tenant UUID into the user's Supabase Auth raw_app_meta_data JSON blob.
--
-- After this fires, the client MUST call supabase.auth.refreshSession() to
-- receive a new JWT containing the updated current_tenant_id claim before
-- making any further authenticated requests. The old JWT will pass the wrong
-- tenant through to RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_tenant_context_switch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER                          -- Must write to auth.users (restricted schema)
SET search_path = public                  -- Prevents search_path hijacking
AS $$
BEGIN
    UPDATE auth.users
    SET raw_app_meta_data =
        jsonb_set(
            COALESCE(raw_app_meta_data, '{}'::jsonb),
            '{current_tenant_id}',
            to_jsonb(NEW.last_accessed_tenant_id)
        )
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

-- Guard: WHEN clause ensures the trigger body only executes when the value
-- has actually changed. Prevents unnecessary auth.users writes on unrelated
-- UPDATE statements that touch other public.users columns.
DROP TRIGGER IF EXISTS on_tenant_switch ON public.users;
CREATE TRIGGER on_tenant_switch
    AFTER UPDATE OF last_accessed_tenant_id ON public.users
    FOR EACH ROW
    WHEN (OLD.last_accessed_tenant_id IS DISTINCT FROM NEW.last_accessed_tenant_id)
    EXECUTE FUNCTION public.handle_tenant_context_switch();

COMMENT ON FUNCTION public.handle_tenant_context_switch IS
    'Syncs last_accessed_tenant_id into auth JWT metadata on context switch. Client must call refreshSession() after.';


-- =============================================================================
-- SECTION 6: ROW-LEVEL SECURITY  (Decision 1c — The RLS Policy Syntax)
--
-- ARCHITECTURE RULE: All tenant-scoped data isolation uses the following
-- extraction pattern. Do not deviate.
--
--   (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
--
-- Why two operators?
--   auth.jwt()                         → returns the full JWT as JSONB
--   -> 'app_metadata'                  → extracts the app_metadata OBJECT (still JSONB)
--   ->> 'current_tenant_id'            → extracts the UUID value as TEXT
--   ::uuid                             → casts TEXT to UUID for safe comparison
--
-- Using auth.jwt() ->> 'current_tenant_id' directly will silently return NULL
-- because current_tenant_id is not a top-level JWT claim. This is the #1
-- implementation mistake — the policy will compile and appear to work, but
-- will deny all rows to all users.
-- =============================================================================

-- Enable RLS. With RLS enabled and no matching policy, all access is DENIED.
ALTER TABLE public.tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships  ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents accidental bypass during development).
ALTER TABLE public.tenants             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships  FORCE ROW LEVEL SECURITY;


-- =============================================================================
-- 6a. POLICIES: public.tenants
--
-- SELECT — A user reads only the tenant matching their active JWT context.
-- The tenant-switcher UI requires listing all tenants the user belongs to;
-- that endpoint uses the service role (bypasses RLS intentionally) to perform:
--   SELECT t.* FROM public.tenants t
--   JOIN public.tenant_memberships tm ON tm.tenant_id = t.id
--   WHERE tm.user_id = <authenticated_user_id>;
--
-- INSERT — Blocked for all authenticated users. Creating a new church/tenant
-- is a platform admin action executed via service role only.
--
-- UPDATE — Restricted to admins of the currently active tenant.
--
-- DELETE — Blocked for all authenticated users. Tenant deletion is a
-- platform admin action executed via service role only.
-- =============================================================================

DROP POLICY IF EXISTS "tenants: select own current context" ON public.tenants;
CREATE POLICY "tenants: select own current context"
    ON public.tenants
    FOR SELECT
    USING (
        id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    );

DROP POLICY IF EXISTS "tenants: update by tenant admin only" ON public.tenants;
CREATE POLICY "tenants: update by tenant admin only"
    ON public.tenants
    FOR UPDATE
    USING (
        -- Must be acting within this tenant's context
        id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND
        -- Caller must hold the 'admin' role in this tenant
        EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            WHERE tm.tenant_id = id
              AND tm.user_id   = auth.uid()
              AND tm.role      = 'admin'
        )
    )
    WITH CHECK (
        id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    );


-- =============================================================================
-- 6b. POLICIES: public.users
--
-- SELECT — A user may read:
--   1. Their own profile (always — needed before a tenant context exists).
--   2. Any other user who shares their current active tenant (member directory).
--
-- INSERT — Handled exclusively by the handle_new_user() SECURITY DEFINER
-- trigger. No INSERT policy is granted to authenticated users.
--
-- UPDATE — A user may update only their own row. This is the mechanism for
-- the POST /api/auth/switch-tenant endpoint: it updates last_accessed_tenant_id,
-- which fires the handle_tenant_context_switch trigger.
--
-- DELETE — Cascades from auth.users ON DELETE CASCADE. No direct deletes
-- are permitted from the application layer.
-- =============================================================================

DROP POLICY IF EXISTS "users: select self or same-tenant member" ON public.users;
CREATE POLICY "users: select self or same-tenant member"
    ON public.users
    FOR SELECT
    USING (
        -- Own profile (works even before tenant context is set)
        id = auth.uid()
        OR
        -- Any user who is a member of the caller's current active tenant
        id IN (
            SELECT tm.user_id
            FROM public.tenant_memberships tm
            WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        )
    );

DROP POLICY IF EXISTS "users: update self only" ON public.users;
CREATE POLICY "users: update self only"
    ON public.users
    FOR UPDATE
    USING (
        id = auth.uid()
    )
    WITH CHECK (
        id = auth.uid()
    );


-- =============================================================================
-- 6c. POLICIES: public.tenant_memberships
--
-- SELECT — A user sees all membership records for their currently active
-- tenant. This powers member lists, role checks, and directory features.
--
-- INSERT — Only admins and pastors of the current tenant may add new members.
-- The EXISTS subquery re-reads tenant_memberships to verify the caller's role.
-- Note: This subquery reads rows the caller can already see (same tenant_id),
-- so there is no RLS recursion issue.
--
-- UPDATE — Only admins of the current tenant may promote/demote member roles.
-- Pastors cannot change roles (they can invite, not re-assign authority).
--
-- DELETE — Admins may remove any member. Any user may remove themselves
-- (leave a church). Pastors cannot forcibly remove members.
-- =============================================================================

DROP POLICY IF EXISTS "memberships: select within current tenant" ON public.tenant_memberships;
CREATE POLICY "memberships: select within current tenant"
    ON public.tenant_memberships
    FOR SELECT
    USING (
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    );

DROP POLICY IF EXISTS "memberships: insert by admin or pastor" ON public.tenant_memberships;
CREATE POLICY "memberships: insert by admin or pastor"
    ON public.tenant_memberships
    FOR INSERT
    WITH CHECK (
        -- The new membership must be for the caller's current active tenant
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND
        -- The caller must be an admin or pastor of that tenant
        EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
              AND tm.user_id   = auth.uid()
              AND tm.role      IN ('admin', 'pastor')
        )
    );

DROP POLICY IF EXISTS "memberships: update role by admin only" ON public.tenant_memberships;
CREATE POLICY "memberships: update role by admin only"
    ON public.tenant_memberships
    FOR UPDATE
    USING (
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND EXISTS (
            SELECT 1
            FROM public.tenant_memberships tm
            WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
              AND tm.user_id   = auth.uid()
              AND tm.role      = 'admin'
        )
    )
    WITH CHECK (
        -- Prevent moving a membership to a different tenant via UPDATE
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    );

DROP POLICY IF EXISTS "memberships: delete by admin or self-removal" ON public.tenant_memberships;
CREATE POLICY "memberships: delete by admin or self-removal"
    ON public.tenant_memberships
    FOR DELETE
    USING (
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
            -- Users may always remove themselves (leave the church)
            user_id = auth.uid()
            OR
            -- Admins may remove any other member
            EXISTS (
                SELECT 1
                FROM public.tenant_memberships tm
                WHERE tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
                  AND tm.user_id   = auth.uid()
                  AND tm.role      = 'admin'
            )
        )
    );


-- =============================================================================
-- SECTION 7: VERIFICATION QUERIES
-- Run these in the Supabase SQL editor or psql after applying this migration
-- to confirm the schema, triggers, and policies are installed correctly.
-- =============================================================================

-- 7a. Confirm all three tables exist with expected columns
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('tenants', 'users', 'tenant_memberships')
-- ORDER BY table_name, ordinal_position;

-- 7b. Confirm RLS is enabled on all three tables
-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('tenants', 'users', 'tenant_memberships');

-- 7c. Confirm all policies are installed
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- 7d. Confirm both trigger functions exist
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('handle_new_user', 'handle_tenant_context_switch');

-- 7e. Confirm both triggers are active
-- SELECT trigger_name, event_object_table, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--    OR event_object_schema = 'auth'
-- ORDER BY event_object_table;

-- 7f. Integration test: simulate a user with a known tenant_id in their JWT
-- (Replace '<your-tenant-uuid>' with a real UUID from the tenants table)
-- SET LOCAL request.jwt.claims = '{
--   "sub": "<user-uuid>",
--   "app_metadata": { "current_tenant_id": "<your-tenant-uuid>" }
-- }';
-- SET LOCAL role = 'authenticated';
-- SELECT * FROM public.tenants;           -- Must return exactly 1 row
-- SELECT * FROM public.tenant_memberships; -- Must return only rows for that tenant
-- RESET role;

COMMIT;
