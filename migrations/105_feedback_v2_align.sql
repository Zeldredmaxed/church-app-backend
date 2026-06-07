-- 105: Feedback v2 — align backend naming with mobile's shipped contract
--
-- Mobile team shipped the Feedback v2 screen ahead of soft-launch using
-- field names that differ from my mig 104 choices. They're the
-- consumer; I adapt. Safe cutover — public.feedback was empty when
-- mig 104 shipped and stays effectively empty pre-launch.
--
-- Naming reconciliation:
--   priority:  'medium' → 'normal'  (mobile's chosen mid-tier name)
--   category:  'frontend' → 'mobile'  (mobile's bucket name)
--              'admin'    → 'admin_web' (mobile's bucket name)
--              'unknown'  → 'uncategorized'
--   (backend kept as 'backend')

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_priority_check;
UPDATE public.feedback SET priority = 'normal' WHERE priority = 'medium';
ALTER TABLE public.feedback ALTER COLUMN priority SET DEFAULT 'normal';
ALTER TABLE public.feedback ADD CONSTRAINT feedback_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'critical'));

-- Category: align with mobile's bucket names. Categorization heuristic
-- in the service auto-fills NULL rows at triage-read time, so existing
-- data stays valid.
UPDATE public.feedback SET category = 'mobile'        WHERE category = 'frontend';
UPDATE public.feedback SET category = 'admin_web'     WHERE category = 'admin';
UPDATE public.feedback SET category = 'uncategorized' WHERE category = 'unknown';

-- Drop the inline CHECK from mig 104 by recreating with the new set.
-- The constraint name PG auto-generated is feedback_category_check.
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_category_check;
ALTER TABLE public.feedback ADD CONSTRAINT feedback_category_check
  CHECK (category IS NULL OR category IN ('mobile', 'backend', 'admin_web', 'uncategorized'));

-- The triage-queue partial index from mig 104 still applies; no change.
