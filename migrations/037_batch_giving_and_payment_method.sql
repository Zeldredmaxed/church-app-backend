-- 037: Batch Giving + Payment Method Tracking
-- Adds offline donation support (cash/check) with batch grouping.

-- Add payment_method to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'online'
  CHECK (payment_method IN ('online', 'cash', 'check'));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS check_number TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Batch header table for audit trail
CREATE TABLE IF NOT EXISTS public.giving_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES public.users(id),
  name        TEXT,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  item_count  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed', 'voided')),
  committed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_giving_batches_tenant
  ON public.giving_batches (tenant_id, created_at DESC);

ALTER TABLE public.giving_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS giving_batches_select ON public.giving_batches;
CREATE POLICY giving_batches_select ON public.giving_batches
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS giving_batches_insert ON public.giving_batches;
CREATE POLICY giving_batches_insert ON public.giving_batches
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

DROP POLICY IF EXISTS giving_batches_update ON public.giving_batches;
CREATE POLICY giving_batches_update ON public.giving_batches
  FOR UPDATE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);
