-- 109: Enterprise custom branding fields on tenants
--
-- Mobile contract: brand_color (existing) stays as a fallback for
-- non-Enterprise tenants. These 6 new fields are Enterprise-only and
-- are NULLed out in the GET response when tier != 'enterprise' so a
-- downgrade can't keep custom branding live.
--
-- No DB CHECK constraints on hex colors / lengths — validation lives
-- in the DTO so we can return structured error codes instead of
-- bare 23514 constraint-violation 500s.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS brand_primary           VARCHAR(7),
  ADD COLUMN IF NOT EXISTS brand_secondary         VARCHAR(7),
  ADD COLUMN IF NOT EXISTS brand_pill_color        VARCHAR(7),
  ADD COLUMN IF NOT EXISTS brand_display_name      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS brand_logo_url          TEXT,
  ADD COLUMN IF NOT EXISTS brand_welcome_message   VARCHAR(200);
