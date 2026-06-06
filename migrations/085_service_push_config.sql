-- 085: Service push configuration fields
--
-- Extends the auto-attendance push config so admins can tune both ends:
--   • start_push_lead_minutes — how many minutes BEFORE starts_at the
--     start push fires (0–30; default 0 preserves existing behaviour
--     where start_push fires at starts_at itself).
--   • end_push_message — admin-customizable body for the end-of-service
--     push (parallel to the existing push_message for the start push).
--
-- end_push_lead_minutes already exists from migration 081.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS start_push_lead_minutes INT NOT NULL DEFAULT 0
    CONSTRAINT services_start_push_lead_chk CHECK (start_push_lead_minutes BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS end_push_message TEXT NULL;
