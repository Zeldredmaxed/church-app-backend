CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_processed_events_at ON public.stripe_processed_events(processed_at);
