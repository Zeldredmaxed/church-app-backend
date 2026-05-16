-- 072: Celebration-seen idempotency for badge awards + sharedBadgeId on posts
--
-- celebration_seen_at: once a member_badges row has been surfaced in a
--   /api/badges/check response, this column is set so the next /check
--   call doesn't re-pop the mobile AchievementModal. NULL means
--   "earned but not yet shown to the user."
--
--   Backfill on rollout: every existing member_badges row is treated as
--   already-celebrated so we don't bombard returning users with their
--   entire historic badge collection on first launch after deploy.
--
-- shared_badge_id on posts: lets the mobile "Share to feed" button auto-
--   compose a post that references the badge. The post still carries its
--   own content; this is just a structured pointer the renderer can use
--   to render a badge card alongside the text.

ALTER TABLE public.member_badges
  ADD COLUMN IF NOT EXISTS celebration_seen_at TIMESTAMPTZ NULL;

-- Treat everything that exists right now as already-shown so the first
-- /badges/check after deploy doesn't replay the user's entire history.
UPDATE public.member_badges
SET celebration_seen_at = awarded_at
WHERE celebration_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_badges_unseen
  ON public.member_badges (user_id, tenant_id)
  WHERE celebration_seen_at IS NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS shared_badge_id UUID NULL
  REFERENCES public.badges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_shared_badge
  ON public.posts (shared_badge_id)
  WHERE shared_badge_id IS NOT NULL;
