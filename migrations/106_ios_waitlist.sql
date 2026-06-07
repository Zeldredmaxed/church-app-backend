-- 106: iOS waitlist — collect emails until TestFlight launch
--
-- Sunday morning: same QR code → install page detects iOS → shows
-- email-capture form → POST /api/ios-waitlist persists the address.
-- Zel exports the list as a TestFlight-ready CSV (one row per email)
-- and uploads via App Store Connect → external testers get invited.
--
-- Marking invited:
--   `invited_at` is stamped when the row is included in a CSV export.
--   The export endpoint can take `?status=pending` to only emit
--   rows that haven't been sent yet — so each export = one delta
--   batch to upload to TestFlight.

CREATE TABLE IF NOT EXISTS public.ios_waitlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercased on insert via the service for case-insensitive dedupe.
  email       TEXT NOT NULL UNIQUE,
  -- Free-form source string so we can A/B test different QR posters
  -- ("Sunday service QR" vs "Pricing page" vs "Bulletin insert").
  source      TEXT NULL,
  -- Optional context — { osVersion, userAgent, country, ... }
  device_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- For abuse / per-IP rate-limit auditing. Nullable since not all
  -- requests will resolve a meaningful IP (CDN edge cases).
  ip_address  INET NULL,
  -- NULL = on the list, not yet invited. NOT NULL = added to the
  -- TestFlight CSV export at this timestamp. Letting Zel re-export
  -- the full list (?status=all) is still possible — invited_at is
  -- informational, not a hard filter.
  invited_at  TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ios_waitlist_pending
  ON public.ios_waitlist (created_at ASC)
  WHERE invited_at IS NULL;

-- No RLS — this is a platform-level waitlist (cross-tenant). Reads
-- are super-admin only via the route guard; writes are public via
-- the throttled endpoint. Service uses dataSource (service-role)
-- with no tenant context.
