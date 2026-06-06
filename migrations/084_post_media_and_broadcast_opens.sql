-- 084: Post media metadata + broadcast open log
--
-- posts.media_aspect: width / height of the uploaded media so mobile
--   can pre-allocate the right cell height (kills first-image layout
--   shift + enables FlatList.getItemLayout for true virtualization).
--
-- posts.transcode_status: explicit terminal state for video posts so
--   mobile stops polling on 'failed' instead of looping forever. NULL
--   for non-video posts. Updated by the Mux webhook handlers.
--
-- broadcast_opens: per-(broadcast, user) open log for push receipts.
--   Idempotent via composite PK so a repeat POST is a no-op.
--   Triggers broadcast_history.read_count increment via trigger.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS media_aspect REAL NULL
    CONSTRAINT posts_media_aspect_chk CHECK (
      media_aspect IS NULL OR (media_aspect > 0 AND media_aspect < 100)
    ),
  ADD COLUMN IF NOT EXISTS transcode_status TEXT NULL
    CONSTRAINT posts_transcode_status_chk CHECK (
      transcode_status IS NULL OR transcode_status IN ('pending', 'ready', 'failed')
    );

-- Backfill: any video post that has a playback_id is 'ready'; without
-- one but with a pending upload, mark 'pending'; everything else NULL.
UPDATE public.posts
SET transcode_status = 'ready'
WHERE media_type = 'video' AND video_mux_playback_id IS NOT NULL
  AND transcode_status IS NULL;

UPDATE public.posts p
SET transcode_status = 'pending'
WHERE p.media_type = 'video' AND p.video_mux_playback_id IS NULL
  AND p.transcode_status IS NULL
  AND EXISTS (SELECT 1 FROM public.pending_video_uploads pvu WHERE pvu.post_id = p.id);

-- ─── Broadcast open log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broadcast_opens (
  broadcast_id UUID NOT NULL REFERENCES public.broadcast_history(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_opens_broadcast
  ON public.broadcast_opens (broadcast_id, opened_at DESC);

ALTER TABLE public.broadcast_opens ENABLE ROW LEVEL SECURITY;

-- Member can record their own open; admin reads aggregate via service-role
DROP POLICY IF EXISTS "broadcast_opens: insert own" ON public.broadcast_opens;
CREATE POLICY "broadcast_opens: insert own" ON public.broadcast_opens
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "broadcast_opens: select own" ON public.broadcast_opens;
CREATE POLICY "broadcast_opens: select own" ON public.broadcast_opens
  FOR SELECT USING (user_id = auth.uid());

-- Trigger maintains the denormalized read_count on broadcast_history so
-- the admin dashboard's "412 of 600 opened" tile is fast.
CREATE OR REPLACE FUNCTION public.broadcast_opens_bump_read_count() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.broadcast_history
  SET read_count = read_count + 1
  WHERE id = NEW.broadcast_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_broadcast_opens_bump ON public.broadcast_opens;
CREATE TRIGGER trg_broadcast_opens_bump
  AFTER INSERT ON public.broadcast_opens
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_opens_bump_read_count();
