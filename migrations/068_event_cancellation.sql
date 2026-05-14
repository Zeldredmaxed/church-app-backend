-- 068: Event cancellation — distinct from delete
--
-- Cancelled events stay visible (so RSVPs know what happened) but are
-- marked with a timestamp and optional reason. The iCal feed and any
-- "live" upcoming-events query should still include them so users see
-- the cancellation rather than have the event silently vanish.
--
-- A NULL cancelled_at means the event is active; a non-NULL value means
-- it was cancelled at that time by some admin/pastor. The cancellation
-- reason is optional free text shown to attendees in the cancellation
-- notification and on the event detail screen.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL;

-- Partial index: most "find upcoming events" queries filter active events.
CREATE INDEX IF NOT EXISTS idx_events_tenant_active_start
  ON public.events (tenant_id, start_at)
  WHERE cancelled_at IS NULL;
