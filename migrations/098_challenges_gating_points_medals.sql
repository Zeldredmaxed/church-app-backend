-- 098: Challenges/Faith Walks — day gating, points, medals, leaderboard, cron
--
-- Mobile UI shipped 28af88d with new gating rules, points curve,
-- Bronze/Silver/Gold/Mythic medal track, and per-challenge leaderboard.
-- UI degrades gracefully when these server-side fields are absent.
-- This migration adds the schema needed to light it up.
--
-- New behavior:
--   - Future days: VIEW only, complete returns 400 TASK_LOCKED
--   - Past missed days: late completion accepted, 0 points, no streak bump
--   - Points per completion by tenant-local hour (earlier = more)
--   - Missed-day cron sweep updates enrollments.missed_count
--   - Badge tier derived at read time from missed_count + on-time pct
--     (Mythic requires top-5 by points on the leaderboard)

-- ─── 1. challenge_task_completions ──────────────────────────────────
-- is_late: completed_on > task's anchored day
-- points_earned: 0-100, capped by the hourly tier (see service)
ALTER TABLE public.challenge_task_completions
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS points_earned INT NOT NULL DEFAULT 0
    CHECK (points_earned >= 0 AND points_earned <= 100);

-- ─── 2. challenge_enrollments ───────────────────────────────────────
-- missed_count: cron-tracked count of past-day tasks not completed
--               on-time (cleared back to "late-completed" on late
--               completion).
-- total_points: SUM(points_earned) for this user/challenge. Bumped
--               atomically on every successful POST /complete.
-- badge_tier:   denormalized for fast list reads; recomputed at read
--               time for the viewer's own enrollment when Mythic is in
--               play (read-path takes priority over denorm freshness).
ALTER TABLE public.challenge_enrollments
  ADD COLUMN IF NOT EXISTS missed_count INT NOT NULL DEFAULT 0
    CHECK (missed_count >= 0),
  ADD COLUMN IF NOT EXISTS total_points INT NOT NULL DEFAULT 0
    CHECK (total_points >= 0),
  ADD COLUMN IF NOT EXISTS badge_tier TEXT NOT NULL DEFAULT 'none'
    CHECK (badge_tier IN ('none','bronze','silver','gold','mythic'));

-- ─── 3. challenge_enrollment_missed_tasks ───────────────────────────
-- Idempotency table for the missed-day cron. Composite PK means
-- re-runs don't double-count. If a user later completes a missed task
-- late, the service deletes the matching row here (so they're moved
-- from "missed" to "late-completed" in the UX).
CREATE TABLE IF NOT EXISTS public.challenge_enrollment_missed_tasks (
  enrollment_id UUID NOT NULL REFERENCES public.challenge_enrollments(id) ON DELETE CASCADE,
  task_id       UUID NOT NULL REFERENCES public.challenge_tasks(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_missed_tasks_tenant
  ON public.challenge_enrollment_missed_tasks (tenant_id);

-- ─── 4. Leaderboard index ───────────────────────────────────────────
-- (challenge_id, total_points DESC, current_streak DESC) supports
-- both `byPoints` ordering and tie-breaker. `byCompletion` orders by
-- completed task count which has its own index pattern (calculated
-- via subquery; no extra index needed since the JOIN drives it).
CREATE INDEX IF NOT EXISTS idx_enrollments_challenge_points
  ON public.challenge_enrollments (challenge_id, total_points DESC, current_streak DESC);

-- ─── 5. RLS for new table ───────────────────────────────────────────
-- Only the service-role cron writes here. The SELECT policy aligns
-- with sibling tables (challenge_enrollments, challenge_task_completions):
-- own rows only via the enrollment. A future read endpoint would
-- naturally surface only the viewer's own missed records.
ALTER TABLE public.challenge_enrollment_missed_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "missed_tasks: select within tenant" ON public.challenge_enrollment_missed_tasks;
DROP POLICY IF EXISTS "missed_tasks: select own" ON public.challenge_enrollment_missed_tasks;
CREATE POLICY "missed_tasks: select own"
  ON public.challenge_enrollment_missed_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.challenge_enrollments e
      WHERE e.id = challenge_enrollment_missed_tasks.enrollment_id
        AND e.user_id = auth.uid()
    )
  );
