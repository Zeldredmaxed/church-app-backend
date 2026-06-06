-- Migration 087: Stripe Checkout for self-serve plan upgrade
--
-- Adds billing-customer + subscription identifiers to public.tenants so we can
-- bill a church monthly via Stripe Checkout/Subscription (separate from the
-- donor flow that uses users.stripe_customer_id and the church's Connect
-- account). The billing customer lives on the platform account, not the
-- Connect account — that's correct because we're charging the church, not
-- routing money to it.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_billing_customer_id TEXT NULL;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_billing_subscription_id TEXT NULL;

-- One billing customer per tenant. Partial unique so multiple NULLs are fine.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_billing_customer_id_uidx
  ON public.tenants (stripe_billing_customer_id)
  WHERE stripe_billing_customer_id IS NOT NULL;
