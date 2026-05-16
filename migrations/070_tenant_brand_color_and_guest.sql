-- 070: Tenant brand color + guest tenant flag
--
-- brand_color: single hex value (#RRGGBB) that the mobile uses to paint
--   ChurchPills, header accents, etc. NULL means "no brand color set"
--   and the frontend falls back to its name-hash color so launch isn't
--   blocked on every church providing a swatch.
--
-- is_guest: marks the single "no church home" tenant. A user who has not
--   joined any real church belongs to this tenant so the rest of the
--   app's RLS / tenant-required paths still work, but church-only
--   endpoints (prayers, fundraisers, etc.) refuse to serve them. The
--   partial unique index enforces "at most one guest tenant in the
--   system" so we can't accidentally fork the no-home state.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS brand_color TEXT NULL
    CONSTRAINT tenants_brand_color_hex_chk
    CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

-- Enforce single guest tenant. Partial unique index over a constant so
-- you cannot insert a second row with is_guest = true.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_single_guest
  ON public.tenants ((1)) WHERE is_guest = true;
