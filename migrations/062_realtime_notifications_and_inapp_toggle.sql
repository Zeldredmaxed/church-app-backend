-- Migration 062: Enable real-time delivery of notifications + in-app toggle.
--
-- The mobile app wants to show a top-of-screen banner when an in-app event
-- arrives (someone messaged, liked, commented, etc.). Best path: subscribe
-- to Postgres logical replication via Supabase Realtime — the
-- notifications table already gets a row per event, RLS already restricts
-- SELECT to recipient_id = auth.uid(), and Realtime respects RLS.
--
-- (1) Add notifications to the supabase_realtime publication.
-- (2) Add in_app_notifications toggle on user_settings, default true.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS in_app_notifications BOOLEAN NOT NULL DEFAULT true;
