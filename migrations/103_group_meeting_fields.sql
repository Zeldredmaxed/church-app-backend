-- 103: Group meeting time fields + verify auto_tag_id wiring
--
-- Mobile asks (PR for first-customer parity):
--   1. Real meeting day/time/frequency on group cards (replaces the
--      placeholder data derived from createdAt's day-of-week)
--   2. Auto-assign group's linked tag when adding a member (column
--      auto_tag_id already exists from migration 097 — service wiring
--      happens in groups.service.ts; this migration just confirms the
--      schema is in place)

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS meeting_day_of_week SMALLINT NULL
    CHECK (meeting_day_of_week IS NULL OR (meeting_day_of_week BETWEEN 0 AND 6)),
  ADD COLUMN IF NOT EXISTS meeting_time_start TIME NULL,
  ADD COLUMN IF NOT EXISTS meeting_frequency TEXT NULL
    CHECK (meeting_frequency IS NULL OR meeting_frequency IN ('weekly', 'biweekly', 'monthly'));

-- Tenants table: monthlyGivingGoalCents was already added in an earlier
-- migration; this verifies it's there for the entity update happening
-- in this same commit (was being read via raw SQL but never on the
-- TypeORM entity, so PATCH /tenants/:id couldn't return it).
-- No-op if already present.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS monthly_giving_goal_cents BIGINT NULL;
