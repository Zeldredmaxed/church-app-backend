-- 035: Add created_at timestamp to tenant_memberships
-- Required by dashboard KPIs (new members this month), growth chart, and reports export.
-- Backfills existing rows from the user's account creation date.

ALTER TABLE public.tenant_memberships
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: set created_at to the user's account creation date for existing rows
UPDATE public.tenant_memberships tm
SET created_at = u.created_at
FROM public.users u
WHERE u.id = tm.user_id
  AND tm.created_at >= now() - interval '1 minute'; -- only backfill rows just defaulted to now()
