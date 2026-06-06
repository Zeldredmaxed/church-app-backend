-- 096: Challenges & Reading Plans (Bible.com-style, fully in-app)
--
-- Pastors author multi-day challenges made of daily tasks. Members
-- enroll, see "today's to-do list", complete each task in-app, and we
-- track completion + streaks for participation reporting. No external
-- redirects (replaces the old Band → Bible.com hop).
--
-- Tables:
--   challenges                 — the plan definition (title, cover, duration)
--   challenge_tasks            — daily tasks (scripture / reflection / checkin)
--   challenge_enrollments      — user ↔ challenge, anchors self-paced "today"
--   challenge_task_completions — one row per (enrollment, task)
--
-- Everything is church/tenant-scoped. Timezone: "today" + streak math
-- bucket by tenants.timezone (migration 077) via
--   (now() AT TIME ZONE t.timezone)::date
-- so a Sunday-evening completion lands on the right local day for
-- churches west of UTC.
--
-- RLS:
--   challenges / challenge_tasks: SELECT + manage within tenant; the
--     admin/pastor write gate lives in the controller layer (RoleGuard).
--     Members see published rows only — enforced in the service WHERE,
--     not RLS (mirrors the shop_items pattern from migration 088).
--   challenge_enrollments / challenge_task_completions: own-row only.
--     Admin participation reporting reads via the service-role
--     connection (documented cross-user aggregate bypass), tenant-pinned
--     in the query.
--
-- Idempotent — safe to re-run.

-- ─── 1. challenges ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description     TEXT NULL CHECK (description IS NULL OR char_length(description) <= 8000),
  cover_image_url TEXT NULL,
  category        TEXT NULL,
  duration_days   INT NOT NULL DEFAULT 1 CHECK (duration_days BETWEEN 1 AND 366),
  -- NULL = self-paced (each enrollee's "day 1" is their enroll date).
  -- A date = fixed cohort start; everyone's day index is anchored to it.
  starts_on       DATE NULL,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_tenant_published
  ON public.challenges (tenant_id, is_published, created_at DESC);

-- ─── 2. challenge_tasks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id          UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day_index             INT NOT NULL CHECK (day_index >= 1),
  position              INT NOT NULL DEFAULT 0 CHECK (position >= 0),
  task_type             TEXT NOT NULL CHECK (task_type IN ('scripture', 'reflection', 'checkin')),
  title                 TEXT NULL CHECK (title IS NULL OR char_length(title) <= 200),
  -- scripture tasks
  scripture_reference   TEXT NULL,
  scripture_translation TEXT NULL,
  -- verse snapshot OR free instructions, depending on task_type
  body                  TEXT NULL CHECK (body IS NULL OR char_length(body) <= 8000),
  -- scripture read-timer gate (seconds the Done button stays disabled)
  timer_seconds         INT NULL CHECK (timer_seconds IS NULL OR (timer_seconds BETWEEN 0 AND 3600)),
  -- reflection prompt shown above the free-text box
  reflection_prompt     TEXT NULL CHECK (reflection_prompt IS NULL OR char_length(reflection_prompt) <= 2000),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, day_index, position)
);

CREATE INDEX IF NOT EXISTS idx_challenge_tasks_challenge_day
  ON public.challenge_tasks (challenge_id, day_index, position);

-- ─── 3. challenge_enrollments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_enrollments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id        UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- tenant-local date the enrollee's day 1 begins. For fixed-start
  -- challenges this is copied from challenges.starts_on; otherwise it's
  -- the local enroll date. day_index = (today_local - started_on) + 1.
  started_on          DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  completed_at        TIMESTAMPTZ NULL,
  current_streak      INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak      INT NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  -- tenant-local date of the most recent completion (drives streak math)
  last_completed_date DATE NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_enrollments_user
  ON public.challenge_enrollments (user_id, status);

CREATE INDEX IF NOT EXISTS idx_challenge_enrollments_challenge
  ON public.challenge_enrollments (challenge_id, status);

-- ─── 4. challenge_task_completions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_task_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   UUID NOT NULL REFERENCES public.challenge_enrollments(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES public.challenge_tasks(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- tenant-local date the task was completed (for daily reset + reporting)
  completed_on    DATE NOT NULL,
  reflection_text TEXT NULL CHECK (reflection_text IS NULL OR char_length(reflection_text) <= 8000),
  seconds_spent   INT NULL CHECK (seconds_spent IS NULL OR seconds_spent >= 0),
  timer_satisfied BOOLEAN NOT NULL DEFAULT true,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_completions_enrollment
  ON public.challenge_task_completions (enrollment_id);

CREATE INDEX IF NOT EXISTS idx_challenge_completions_tenant_task
  ON public.challenge_task_completions (tenant_id, task_id);

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.challenges                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_enrollments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_task_completions ENABLE ROW LEVEL SECURITY;

-- challenges: SELECT within tenant (members + admins). Member surfaces
-- filter is_published = true in the service WHERE.
DROP POLICY IF EXISTS "challenges: select within tenant" ON public.challenges;
CREATE POLICY "challenges: select within tenant"
  ON public.challenges FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- challenges: ALL within tenant (admin/pastor gate is the RoleGuard in
-- the controller; RLS just pins tenant).
DROP POLICY IF EXISTS "challenges: manage within tenant" ON public.challenges;
CREATE POLICY "challenges: manage within tenant"
  ON public.challenges FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- challenge_tasks: SELECT within tenant.
DROP POLICY IF EXISTS "challenge_tasks: select within tenant" ON public.challenge_tasks;
CREATE POLICY "challenge_tasks: select within tenant"
  ON public.challenge_tasks FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- challenge_tasks: ALL within tenant.
DROP POLICY IF EXISTS "challenge_tasks: manage within tenant" ON public.challenge_tasks;
CREATE POLICY "challenge_tasks: manage within tenant"
  ON public.challenge_tasks FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid);

-- challenge_enrollments: own row only.
DROP POLICY IF EXISTS "challenge_enrollments: select own" ON public.challenge_enrollments;
CREATE POLICY "challenge_enrollments: select own"
  ON public.challenge_enrollments FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "challenge_enrollments: insert own" ON public.challenge_enrollments;
CREATE POLICY "challenge_enrollments: insert own"
  ON public.challenge_enrollments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "challenge_enrollments: update own" ON public.challenge_enrollments;
CREATE POLICY "challenge_enrollments: update own"
  ON public.challenge_enrollments FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- challenge_task_completions: own row only.
DROP POLICY IF EXISTS "challenge_completions: select own" ON public.challenge_task_completions;
CREATE POLICY "challenge_completions: select own"
  ON public.challenge_task_completions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "challenge_completions: insert own" ON public.challenge_task_completions;
CREATE POLICY "challenge_completions: insert own"
  ON public.challenge_task_completions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "challenge_completions: update own" ON public.challenge_task_completions;
CREATE POLICY "challenge_completions: update own"
  ON public.challenge_task_completions FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
