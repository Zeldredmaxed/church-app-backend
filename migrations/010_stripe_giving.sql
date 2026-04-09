-- ============================================================================
-- Migration 010: Stripe Connect & Giving Flow
-- ============================================================================
-- Prerequisite: 009_full_text_search.sql applied
--
-- Creates:
--   S SECTION 1 -- Add stripe columns to tenants
--   S SECTION 2 -- transactions table
--   S SECTION 3 -- transactions RLS policies
--   S SECTION 4 -- Performance indexes
--   S SECTION 5 -- Verification queries
-- ============================================================================

-- ============================================================================
-- S SECTION 1 -- Add stripe columns to tenants
-- ============================================================================
-- stripe_account_id: The Stripe Connect account ID (acct_xxx).
-- stripe_account_status: Tracks onboarding state — controls whether giving is enabled.
--
-- NOTE: tenants.stripe_account_id may already exist from an earlier entity definition
-- that included it. We use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS to be idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'stripe_account_id'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN stripe_account_id TEXT UNIQUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'stripe_account_status'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN stripe_account_status TEXT NOT NULL DEFAULT 'pending';
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.stripe_account_id IS
  'Stripe Connect account ID (acct_xxx). NULL until the admin begins onboarding. '
  'UNIQUE constraint prevents two tenants from sharing a Stripe account.';

COMMENT ON COLUMN public.tenants.stripe_account_status IS
  'Stripe Connect onboarding status: pending (not started), onboarding (in progress), '
  'active (charges enabled), restricted (action required). '
  'Updated by the Stripe account.updated webhook.';

-- ============================================================================
-- S SECTION 2 -- transactions table
-- ============================================================================
-- Records all giving/donation transactions processed through Stripe.
-- Each transaction is tied to a tenant (church receiving the donation)
-- and a user (the donor).

CREATE TABLE IF NOT EXISTS public.transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount            DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  currency          TEXT NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transactions IS
  'Donation/giving transactions processed through Stripe Connect. '
  'status tracks the payment lifecycle via Stripe webhooks.';

-- ============================================================================
-- S SECTION 3 -- transactions RLS policies
-- ============================================================================

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;

-- SELECT: A user can see their own transactions across tenants.
-- A tenant admin can see ALL transactions for their current tenant.
DROP POLICY IF EXISTS "transactions: select own or admin" ON public.transactions;
CREATE POLICY "transactions: select own or admin"
  ON public.transactions
  FOR SELECT
  USING (
    -- Users can always see their own donations
    user_id = (auth.jwt() ->> 'sub')::uuid
    OR
    -- Tenant admins can see all tenant transactions
    (
      tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
      AND EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
          AND tm.role = 'admin'
      )
    )
  );

-- INSERT: A user can create a transaction for themselves in the current tenant.
-- The user_id must match the authenticated user (no impersonation).
DROP POLICY IF EXISTS "transactions: insert own donation" ON public.transactions;
CREATE POLICY "transactions: insert own donation"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')::uuid
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- UPDATE: Only service role (webhook processor) can update transaction status.
-- No RLS UPDATE policy for the 'authenticated' role — users cannot modify
-- transaction status. This is the same pattern as notifications.

-- No DELETE policy — transactions are immutable financial records.

-- ============================================================================
-- S SECTION 4 -- Performance indexes
-- ============================================================================

-- Query: "my donations" (user's giving history)
CREATE INDEX IF NOT EXISTS idx_transactions_user
  ON public.transactions (user_id, created_at DESC);

-- Query: "tenant transactions" (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_transactions_tenant
  ON public.transactions (tenant_id, created_at DESC);

-- Query: lookup by Stripe PaymentIntent ID (webhook processing)
-- Already covered by the UNIQUE constraint on stripe_payment_intent_id

-- Query: tenant Stripe account lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_stripe_account_id
  ON public.tenants (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- ============================================================================
-- S SECTION 5 -- Verification queries
-- ============================================================================

-- 5a: Stripe columns exist on tenants
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'tenants'
--   AND column_name IN ('stripe_account_id', 'stripe_account_status')
-- ORDER BY column_name;
-- Expected: 2 rows

-- 5b: transactions table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'transactions'
-- ORDER BY ordinal_position;

-- 5c: RLS enabled on transactions
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'transactions';
-- Expected: rowsecurity = true

-- 5d: RLS policies on transactions (expect 2: SELECT, INSERT)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'transactions'
-- ORDER BY policyname;

-- 5e: Amount check constraint
-- INSERT INTO public.transactions (tenant_id, user_id, amount, currency, stripe_payment_intent_id, status)
-- VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', -10, 'usd', 'pi_test', 'pending');
-- Expected: ERROR — violates check constraint (amount > 0)

-- 5f: Status check constraint
-- INSERT INTO public.transactions (tenant_id, user_id, amount, currency, stripe_payment_intent_id, status)
-- VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 10, 'usd', 'pi_test2', 'invalid');
-- Expected: ERROR — violates check constraint

-- 5g: Unique stripe_payment_intent_id
-- INSERT INTO public.transactions (..., stripe_payment_intent_id, ...) VALUES (..., 'pi_duplicate', ...);
-- INSERT INTO public.transactions (..., stripe_payment_intent_id, ...) VALUES (..., 'pi_duplicate', ...);
-- Expected: second INSERT fails with unique violation (23505)
