-- 081: End-of-service push tracking
--
-- The pastor's spec calls for two checks per service: one at start,
-- one at end. Migration 080 already tracks start_push_sent_at; this
-- adds the parallel end_push_sent_at + end_push_lead_minutes (how
-- many minutes before ends_at to fire the push so the phone has time
-- to respond before the sweep runs at end + 5 min).

ALTER TABLE public.service_occurrences
  ADD COLUMN IF NOT EXISTS end_push_sent_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_service_occ_pending_end_push
  ON public.service_occurrences (ends_at)
  WHERE end_push_sent_at IS NULL AND is_cancelled = false;

-- Default end-push lead time is 3 min before service ends — gives the
-- mobile + queue + Expo enough headroom to deliver before the sweep
-- runs at end + 5 min. Configurable per-service.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS end_push_lead_minutes INT NOT NULL DEFAULT 3
    CONSTRAINT services_end_push_lead_chk CHECK (end_push_lead_minutes BETWEEN 0 AND 30);
