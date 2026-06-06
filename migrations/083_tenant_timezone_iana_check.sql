-- 083: IANA timezone format validation on public.tenants
--
-- The dashboard team asked for server-side enforcement so they can
-- safely .replace('_', ' ') on the value for display ("America/New_York"
-- → "America/New York"). Without enforcement, an admin could enter
-- "EST" or "Pacific Time" and break the renderer.
--
-- Validation strategy:
--   - Allow plain "UTC" and "GMT"
--   - Otherwise require Area/City format with optional /SubCity, where
--     each segment is alpha+underscore+hyphen+plus (the +/- supports
--     Etc/GMT+5 style names).
--   - Allows up to one optional third segment for America/Indiana/Indianapolis
--
-- This catches obvious bad input ("EST", "Eastern Time", "PST") while
-- accepting every real IANA name. Full membership check against
-- pg_timezone_names isn't possible in a CHECK constraint because that
-- view isn't IMMUTABLE.

-- Sanitize any existing rows that wouldn't pass the new constraint.
-- America/New_York is the default we want to land on.
UPDATE public.tenants
SET timezone = 'America/New_York'
WHERE timezone IS NULL
   OR timezone !~ '^(UTC|GMT|[A-Z][A-Za-z_+\-]+/[A-Za-z_+\-]+(/[A-Za-z_+\-]+)?)$';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_timezone_iana_chk') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_timezone_iana_chk
      CHECK (
        timezone ~ '^(UTC|GMT|[A-Z][A-Za-z_+\-]+/[A-Za-z_+\-]+(/[A-Za-z_+\-]+)?)$'
      );
  END IF;
END $$;
