-- Migration 049: User Blocks + User-Facing Report Endpoints
-- Required for Apple App Store and Google Play approval (UGC moderation).

-- 1. User blocks table
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON public.user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_blocks: manage own"
  ON public.user_blocks FOR ALL
  USING (blocker_id = auth.uid());

-- 2. Add report_reason and content_type to post_reports for broader content reporting
ALTER TABLE public.post_reports
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'post',
  ADD COLUMN IF NOT EXISTS comment_id UUID,
  ADD COLUMN IF NOT EXISTS user_id UUID;
