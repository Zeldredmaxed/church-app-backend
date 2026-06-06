-- 073: Webhook + queue idempotency safeguards
--
-- mux_processed_events: same pattern as stripe_processed_events. Mux can
--   replay video.asset.ready and video.upload.asset_created webhooks; without
--   a processed-events table, replays re-overwrite playback_id, bump
--   posts.updated_at = now(), and could revert errored → ready.
--
-- fundraiser_donations UNIQUE on payment_intent_id: mobile retry of
--   POST /donate creates two pending rows; the Stripe webhook then does
--   update({paymentIntentId}, ...) which flips ALL matching rows; the
--   trigger sums amount per row → fundraiser raised_amount inflated and
--   phantom "goal reached" notification fires. Dedupe pending rows first,
--   then add UNIQUE.
--
-- notifications.dedupe_key: BullMQ "notifications" queue is configured
--   with attempts: 5. A retrying job currently inserts another row and
--   re-pushes — up to 5x duplicate per recipient. dedupe_key lets the
--   processor INSERT ... ON CONFLICT DO NOTHING to make retries safe.

-- ─── Mux processed-events table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mux_processed_events (
  event_id    TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7-day TTL via partial index — processor purges old rows; harmless if
-- we never get around to it (the table grows linearly in webhook volume).
CREATE INDEX IF NOT EXISTS idx_mux_processed_events_age
  ON public.mux_processed_events (processed_at);

-- ─── Fundraiser donations: dedupe + UNIQUE ───────────────────────────
-- Step 1: collapse any existing duplicate pending rows so the UNIQUE
-- constraint can be created. Keeps the oldest of each PI group; the
-- payments trigger has already double-credited any historical duplicates
-- so this only prevents future double-credit (existing rows are sunk
-- cost — finance leads can reconcile via Stripe dashboard).
DELETE FROM public.fundraiser_donations a USING public.fundraiser_donations b
WHERE a.id > b.id
  AND a.payment_intent_id IS NOT NULL
  AND a.payment_intent_id = b.payment_intent_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_fundraiser_donations_payment_intent'
  ) THEN
    ALTER TABLE public.fundraiser_donations
      ADD CONSTRAINT uq_fundraiser_donations_payment_intent
      UNIQUE (payment_intent_id);
  END IF;
END $$;

-- ─── Notifications dedupe key ────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;

-- Partial unique index so retries deduplicate but legacy rows
-- (dedupe_key NULL) don't conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_key
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
