-- Migration 042: Fundraiser / Crowdfunding System
-- Churches on premium/enterprise tiers can create fundraisers with targets, deadlines, and categories.
-- Members can donate (with Stripe), bookmark, and browse fundraisers.

-- 1. Fundraisers table
CREATE TABLE IF NOT EXISTS public.fundraisers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  overview TEXT NOT NULL CHECK (char_length(overview) <= 2000),
  category TEXT NOT NULL CHECK (category IN ('Education', 'Fundraising', 'Disaster', 'Health', 'Community', 'Missions')),
  target_amount BIGINT NOT NULL CHECK (target_amount > 0),
  raised_amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  backer_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundraisers_tenant ON public.fundraisers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fundraisers_category ON public.fundraisers(category);
CREATE INDEX IF NOT EXISTS idx_fundraisers_status ON public.fundraisers(status);
CREATE INDEX IF NOT EXISTS idx_fundraisers_ends_at ON public.fundraisers(ends_at);

-- 2. Fundraiser donations table
CREATE TABLE IF NOT EXISTS public.fundraiser_donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id UUID NOT NULL REFERENCES public.fundraisers(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES public.users(id),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  amount BIGINT NOT NULL CHECK (amount >= 100),
  message TEXT CHECK (char_length(message) <= 200),
  payment_intent_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'succeeded', 'failed', 'refunded')),
  anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fdonations_fundraiser ON public.fundraiser_donations(fundraiser_id);
CREATE INDEX IF NOT EXISTS idx_fdonations_donor ON public.fundraiser_donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_fdonations_status ON public.fundraiser_donations(payment_status);
CREATE INDEX IF NOT EXISTS idx_fdonations_payment_intent ON public.fundraiser_donations(payment_intent_id);

-- 3. Fundraiser bookmarks table
CREATE TABLE IF NOT EXISTS public.fundraiser_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fundraiser_id UUID NOT NULL REFERENCES public.fundraisers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fundraiser_id, user_id)
);

-- 4. Trigger: auto-update raised_amount, backer_count, and status on donation changes
CREATE OR REPLACE FUNCTION public.update_fundraiser_totals()
RETURNS TRIGGER AS $$
BEGIN
  -- New succeeded donation (direct insert or status change to succeeded)
  IF TG_OP = 'INSERT' AND NEW.payment_status = 'succeeded' THEN
    UPDATE public.fundraisers SET
      raised_amount = raised_amount + NEW.amount,
      backer_count = (
        SELECT COUNT(DISTINCT donor_id)
        FROM public.fundraiser_donations
        WHERE fundraiser_id = NEW.fundraiser_id AND payment_status = 'succeeded'
      ),
      status = CASE
        WHEN raised_amount + NEW.amount >= target_amount THEN 'completed'
        ELSE status
      END,
      updated_at = now()
    WHERE id = NEW.fundraiser_id;
  END IF;

  -- Status changed to succeeded (webhook confirmation)
  IF TG_OP = 'UPDATE' AND OLD.payment_status != 'succeeded' AND NEW.payment_status = 'succeeded' THEN
    UPDATE public.fundraisers SET
      raised_amount = raised_amount + NEW.amount,
      backer_count = (
        SELECT COUNT(DISTINCT donor_id)
        FROM public.fundraiser_donations
        WHERE fundraiser_id = NEW.fundraiser_id AND payment_status = 'succeeded'
      ),
      status = CASE
        WHEN raised_amount + NEW.amount >= target_amount THEN 'completed'
        ELSE status
      END,
      updated_at = now()
    WHERE id = NEW.fundraiser_id;
  END IF;

  -- Refund: subtract amount
  IF TG_OP = 'UPDATE' AND OLD.payment_status = 'succeeded' AND NEW.payment_status = 'refunded' THEN
    UPDATE public.fundraisers SET
      raised_amount = GREATEST(raised_amount - NEW.amount, 0),
      backer_count = (
        SELECT COUNT(DISTINCT donor_id)
        FROM public.fundraiser_donations
        WHERE fundraiser_id = NEW.fundraiser_id AND payment_status = 'succeeded'
      ),
      updated_at = now()
    WHERE id = NEW.fundraiser_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_fundraiser_totals ON public.fundraiser_donations;
CREATE TRIGGER trg_update_fundraiser_totals
  AFTER INSERT OR UPDATE ON public.fundraiser_donations
  FOR EACH ROW EXECUTE FUNCTION public.update_fundraiser_totals();

-- 5. RLS policies
ALTER TABLE public.fundraisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fundraiser_donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fundraiser_bookmarks ENABLE ROW LEVEL SECURITY;

-- Fundraisers: read within current tenant
CREATE POLICY "fundraisers: select within tenant"
  ON public.fundraisers FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Fundraisers: manage within current tenant (insert/update/delete)
CREATE POLICY "fundraisers: manage within tenant"
  ON public.fundraisers FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Donations: insert own
CREATE POLICY "fundraiser_donations: insert own"
  ON public.fundraiser_donations FOR INSERT
  WITH CHECK (
    donor_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Donations: select within tenant (anonymous donations hide donor info at app layer)
CREATE POLICY "fundraiser_donations: select within tenant"
  ON public.fundraiser_donations FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- Donations: service role can update payment_status (webhooks)
CREATE POLICY "fundraiser_donations: service update"
  ON public.fundraiser_donations FOR UPDATE
  USING (true);

-- Bookmarks: manage own
CREATE POLICY "fundraiser_bookmarks: manage own"
  ON public.fundraiser_bookmarks FOR ALL
  USING (user_id = auth.uid());
