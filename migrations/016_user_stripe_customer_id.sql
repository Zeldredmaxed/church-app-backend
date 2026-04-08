-- =============================================================================
-- Migration 016: Add stripe_customer_id to users
--
-- Stores the Stripe Customer ID per user so saved payment methods persist
-- across sessions and tenants. Created lazily via POST /api/stripe/setup-intent.
--
-- Depends on: 001_initial_schema_and_rls.sql (users table)
-- =============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

COMMENT ON COLUMN public.users.stripe_customer_id IS
  'Stripe Customer ID (cus_xxx). Created lazily on first SetupIntent. '
  'User-global — saved cards work across all tenant contexts.';

COMMIT;
