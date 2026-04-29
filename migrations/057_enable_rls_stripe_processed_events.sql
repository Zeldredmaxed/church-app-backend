-- Migration 057: Enable RLS on stripe_processed_events.
--
-- This table is the Stripe webhook idempotency ledger — it records which
-- Stripe event_ids the webhook handler has already processed so retries
-- don't double-fire side effects. Only the webhook handler (running as the
-- service role, BYPASSRLS) ever reads or writes it; no authenticated user
-- has any reason to touch this table.
--
-- Enabling RLS with no policies = deny-all for non-service-role access.
-- Service role continues to work unaffected.

ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_processed_events FORCE ROW LEVEL SECURITY;
