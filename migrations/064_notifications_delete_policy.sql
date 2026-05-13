-- Migration 064: Allow recipients to delete their own notifications.
--
-- The notifications table has SELECT + UPDATE policies but no DELETE.
-- The clear-notifications UX on mobile needs DELETE /api/notifications/:id
-- to succeed; the service itself uses the service-role DataSource (so it
-- bypasses RLS), but the policy is defense-in-depth for any future code
-- path that goes through the authenticated role (e.g. PostgREST, Realtime
-- detach scenarios).

DROP POLICY IF EXISTS "notifications: delete own within tenant" ON public.notifications;
CREATE POLICY "notifications: delete own within tenant"
  ON public.notifications FOR DELETE
  USING (
    recipient_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
