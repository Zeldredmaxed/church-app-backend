-- ============================================================================
-- Migration 005: Notifications Table
-- ============================================================================
-- Prerequisite: 004_comments.sql applied
--
-- Creates:
--   § SECTION 1 — notifications table
--   § SECTION 2 — RLS policies (2 policies)
--   § SECTION 3 — Performance indexes
--   § SECTION 4 — Verification queries
-- ============================================================================

BEGIN;

-- ============================================================================
-- § SECTION 1 — notifications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The user who receives the notification
  recipient_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The tenant context in which the notification was generated.
  -- Denormalised for RLS performance (same pattern as comments.tenant_id).
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Notification type: NEW_COMMENT, POST_MENTION, INVITATION_ACCEPTED, etc.
  type          TEXT NOT NULL,

  -- Structured payload — varies by type. Examples:
  --   NEW_COMMENT:    { "postId": "...", "commentId": "...", "actorName": "...", "preview": "..." }
  --   POST_MENTION:   { "postId": "...", "actorName": "...", "preview": "..." }
  payload       JSONB NOT NULL DEFAULT '{}',

  -- Read/unread state
  read_at       TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reuse the set_updated_at() trigger function from migration 003
CREATE TRIGGER set_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.notifications IS
  'In-app notifications. One row per recipient per event. '
  'tenant_id is denormalised for RLS performance.';

-- ============================================================================
-- § SECTION 2 — Row-Level Security
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

-- Policy 1: Users can only see their own notifications within the current tenant
CREATE POLICY "notifications: select own within tenant"
  ON public.notifications
  FOR SELECT
  USING (
    recipient_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Policy 2: Users can only update (mark as read) their own notifications
CREATE POLICY "notifications: update own within tenant"
  ON public.notifications
  FOR UPDATE
  USING (
    recipient_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  )
  WITH CHECK (
    recipient_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- No INSERT policy for the 'authenticated' role — notifications are created
-- by the backend service using a service-role connection (BullMQ processor),
-- which bypasses RLS. This prevents users from fabricating notifications.

-- No DELETE policy — notifications are soft-archived via read_at, not deleted.
-- If purging is needed later, a service-role background job handles it.

-- ============================================================================
-- § SECTION 3 — Performance indexes
-- ============================================================================

-- Primary query: GET /notifications (my unread notifications, newest first)
CREATE INDEX idx_notifications_recipient_unread
  ON public.notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

-- Secondary query: GET /notifications?all=true (all notifications, paginated)
CREATE INDEX idx_notifications_recipient_created
  ON public.notifications (recipient_id, tenant_id, created_at DESC);

-- ============================================================================
-- § SECTION 4 — Verification queries
-- ============================================================================

-- Run these after applying the migration to confirm everything is in place.

-- 4a: Table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'notifications'
-- ORDER BY ordinal_position;

-- 4b: RLS policies (expect 2)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'notifications'
-- ORDER BY policyname;

-- 4c: Indexes
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'notifications';

-- 4d: Trigger
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'notifications' AND trigger_name = 'set_notifications_updated_at';

COMMIT;
