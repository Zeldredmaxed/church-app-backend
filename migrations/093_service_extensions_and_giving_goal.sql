-- Migration 093: Service extensions + tenant monthly giving goal
--
-- F1: Extends public.services with pastor, location, capacity, tags so the
--     admin "Service" CRUD can carry richer metadata for the dashboard tiles.
-- F2: Adds tenants.monthly_giving_goal_cents so the giving KPI cards can
--     show a goalAmount + computed growthPct against last month.
--
-- All columns are NULL/default-safe and the migration is idempotent.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS pastor TEXT NULL,
  ADD COLUMN IF NOT EXISTS location TEXT NULL,
  ADD COLUMN IF NOT EXISTS capacity INT NULL,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_capacity_positive_chk'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_capacity_positive_chk CHECK (capacity IS NULL OR capacity > 0);
  END IF;
END$$;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS monthly_giving_goal_cents BIGINT NULL;
