-- 104: Feedback triage workflow (bug reports + feature requests pile-up)
--
-- Pastors / members tap "Report a Bug" or "Request a Feature" in the
-- app → row lands in public.feedback. Zel asks Claude "check the bug
-- logs" → Claude queries the triage view, classifies each item by
-- category (frontend/backend/admin) + severity, posts a sorted punch
-- list back. Manual workflow now; Paperclip automation later.
--
-- Additions:
--   1. screenshot_urls TEXT[]  — S3 URLs from /api/media presigned upload
--   2. device_info JSONB       — OS, app version, route the user was on
--   3. category TEXT NULL      — set during triage: frontend|backend|admin|unknown
--   4. priority CHECK adds 'critical' (was low|medium|high)
--   5. triaged_at + triaged_by + triage_notes — review state
--
-- All fields nullable so existing rows remain valid and old client
-- submissions (pre-103 mobile) still work without screenshots.

-- 1. Screenshots — array of S3 URLs.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS screenshot_urls TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

-- 2. Device / context info JSONB. Mobile sends:
--   { platform: 'ios'|'android'|'web', osVersion, appVersion, route,
--     buildNumber? }
-- Helps me reproduce bugs that only manifest on a specific OS or screen.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS device_info JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Triage category. NULL until classified.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS category TEXT NULL
    CHECK (category IS NULL OR category IN ('frontend', 'backend', 'admin', 'unknown'));

-- 4. Expand priority to include 'critical' for top-severity bugs
--    (data loss, money flow broken, login broken, etc.).
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_priority_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'critical'));

-- 5. Triage marker fields. NULL until I (or future Paperclip Triage
--    Officer agent) reviews + classifies.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS triaged_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS triage_notes TEXT NULL;

-- Partial index supporting the triage-queue query (sort by priority +
-- created_at happens in the service-layer ORDER BY since CASE
-- expressions in CREATE INDEX need extra parentheses Postgres
-- doesn't accept in our exact form — and a plain (priority,
-- created_at) wouldn't sort priority correctly anyway because
-- 'critical' alphabetizes wrong). Triage queue is small (open items
-- per platform), so a partial-by-untriaged index is plenty.
CREATE INDEX IF NOT EXISTS idx_feedback_untriaged
  ON public.feedback (created_at ASC)
  WHERE triaged_at IS NULL;

-- Add a second index for the per-category sweep:
-- "show me all open backend bugs, critical first".
CREATE INDEX IF NOT EXISTS idx_feedback_category_status
  ON public.feedback (category, status, created_at DESC)
  WHERE status != 'closed';

-- RLS already exists on this table (tenant-scoped on SELECT). For the
-- super-admin cross-tenant triage view, the service uses dataSource
-- (service-role) which bypasses RLS — documented justification.
