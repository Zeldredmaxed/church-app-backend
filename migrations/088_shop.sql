-- Migration 088: Shop module (per-tenant church store)
--
-- Tables:
--   shop_items         — products a church can sell (merch, books, media, etc.)
--   shop_item_options  — per-item options (sizes, colors) with optional price delta
--   shop_orders        — order ledger; one row per Stripe PaymentIntent
--
-- Money is stored in CENTS everywhere (BIGINT). Payment routes through the
-- tenant's Stripe Connect account with the platform fee
-- (tier-features.config) applied as application_fee_amount — mirrors the
-- giving flow.
--
-- RLS:
--   shop_items: SELECT within tenant; ALL (insert/update/delete) restricted
--     to admin-class roles via app-layer guards (RoleGuard) — DB policy
--     simply pins tenant_id to the JWT's current_tenant_id.
--   shop_orders: SELECT own order rows; INSERT own (user_id = auth.uid()).
--     Service role (webhook handler) updates status on PI events.
--
-- Idempotent — safe to re-run.

-- 1. shop_items
CREATE TABLE IF NOT EXISTS public.shop_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description  TEXT NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  price_cents  BIGINT NOT NULL CHECK (price_cents >= 0),
  category     TEXT NOT NULL CHECK (category IN ('Merch', 'Events', 'Giving', 'Books', 'Media')),
  section      TEXT NULL,
  image_url    TEXT NULL,
  in_stock     BOOLEAN NOT NULL DEFAULT true,
  hot          BOOLEAN NOT NULL DEFAULT false,
  stock        INT NULL CHECK (stock IS NULL OR stock >= 0),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_items_tenant_active
  ON public.shop_items (tenant_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_items_tenant_category
  ON public.shop_items (tenant_id, category)
  WHERE is_active = true;

-- 2. shop_item_options
CREATE TABLE IF NOT EXISTS public.shop_item_options (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            UUID NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  label              TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  price_delta_cents  BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shop_item_options_item
  ON public.shop_item_options (item_id);

-- 3. shop_orders
CREATE TABLE IF NOT EXISTS public.shop_orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  item_id                   UUID NOT NULL REFERENCES public.shop_items(id) ON DELETE RESTRICT,
  quantity                  INT NOT NULL CHECK (quantity > 0),
  option_ids                UUID[] NOT NULL DEFAULT '{}',
  total_cents               BIGINT NOT NULL CHECK (total_cents >= 0),
  stripe_payment_intent_id  TEXT NULL UNIQUE,
  status                    TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_tenant_user
  ON public.shop_orders (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_orders_tenant_status
  ON public.shop_orders (tenant_id, status, created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.shop_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders       ENABLE ROW LEVEL SECURITY;

-- shop_items: SELECT within tenant
DROP POLICY IF EXISTS "shop_items: select within tenant" ON public.shop_items;
CREATE POLICY "shop_items: select within tenant"
  ON public.shop_items FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- shop_items: ALL within tenant (admin role gating handled in the controller
-- layer with RoleGuard — keeping the RLS check tenant-scoped allows the
-- service-role webhook handler to bypass).
DROP POLICY IF EXISTS "shop_items: manage within tenant" ON public.shop_items;
CREATE POLICY "shop_items: manage within tenant"
  ON public.shop_items FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- shop_item_options: SELECT when the parent item is visible in the tenant.
DROP POLICY IF EXISTS "shop_item_options: select with parent" ON public.shop_item_options;
CREATE POLICY "shop_item_options: select with parent"
  ON public.shop_item_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_items si
      WHERE si.id = shop_item_options.item_id
        AND si.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  );

-- shop_item_options: ALL when the parent item is in the tenant.
DROP POLICY IF EXISTS "shop_item_options: manage with parent" ON public.shop_item_options;
CREATE POLICY "shop_item_options: manage with parent"
  ON public.shop_item_options FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_items si
      WHERE si.id = shop_item_options.item_id
        AND si.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shop_items si
      WHERE si.id = shop_item_options.item_id
        AND si.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    )
  );

-- shop_orders: SELECT own
DROP POLICY IF EXISTS "shop_orders: select own" ON public.shop_orders;
CREATE POLICY "shop_orders: select own"
  ON public.shop_orders FOR SELECT
  USING (user_id = auth.uid());

-- shop_orders: INSERT own (pins user_id + tenant_id to the JWT)
DROP POLICY IF EXISTS "shop_orders: insert own" ON public.shop_orders;
CREATE POLICY "shop_orders: insert own"
  ON public.shop_orders FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
