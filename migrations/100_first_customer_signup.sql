-- 100: First-customer readiness — paid signup + invitation email
--
-- Adds the bits needed for the public new-church signup flow:
--   1. tenants.country (US-default — was missing from the address set)
--   2. invitations.cancelled_at (soft-cancel marker for DELETE endpoint)
--
-- The signup flow itself doesn't need a new table — pending tenant
-- creation is encoded in Stripe Checkout session metadata, then the
-- checkout.session.completed webhook materializes the tenant +
-- founding admin idempotently using the session ID as the dedupe key.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'US'
    CHECK (char_length(country) BETWEEN 2 AND 2);

-- Soft-cancel on invitations so the DELETE endpoint preserves history
-- (for audit log + "you tried to invite this person 3 times" UX).
-- The accept flow already gates on accepted_at IS NULL; tightening it
-- to also require cancelled_at IS NULL keeps cancelled invites
-- from being usable.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL;

-- Index supports the controller filter "show me my pending invites".
CREATE INDEX IF NOT EXISTS idx_invitations_pending
  ON public.invitations (tenant_id, created_at DESC)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- Idempotency for the signup webhook: dedupe by stripe_session_id so
-- a webhook retry can't double-create a tenant.
CREATE TABLE IF NOT EXISTS public.tenant_signup_completions (
  stripe_session_id TEXT PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  admin_user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
