-- 069: Mux Direct Upload pending-state table + crop-rect on posts/stories
--
-- Flow we're enabling:
--   1. Mobile asks backend for a Mux Direct Upload URL.
--   2. Backend creates the upload via Mux API, inserts a row here with
--      mux_upload_id and status='awaiting_upload'.
--   3. Mobile PUTs the raw video bytes to the upload URL (no backend hop).
--   4. Mobile creates a post referencing the upload_id and crop_rect.
--      Backend writes the post with NULL playback_id and links the pending
--      row to the post_id (status='processing').
--   5. Mux webhook 'video.upload.asset_created' fills in mux_asset_id.
--   6. Mux webhook 'video.asset.ready' fills in mux_playback_id and copies
--      it to the post row (status='ready').
--
-- crop_rect is stored as JSONB on BOTH the pending row (so a future
-- server-side transcode worker can find what to crop) and on the post/story
-- row (so playback can apply CSS-side crop until the transcode lands).
-- Shape: { x, y, width, height } — all normalized 0..1, with origin at
-- top-left. Optional { aspectRatio } for the target frame.

CREATE TABLE IF NOT EXISTS public.pending_video_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mux_upload_id   TEXT NOT NULL UNIQUE,
  mux_asset_id    TEXT NULL,
  mux_playback_id TEXT NULL,
  -- Set once the mobile creates the post that owns this upload. Until then
  -- the upload is orphaned — a cleanup job can purge old orphans.
  post_id         UUID NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  story_id        UUID NULL,  -- FK added defensively below if stories table exists
  crop_rect       JSONB NULL,
  -- Lifecycle: awaiting_upload → processing → ready  (or → errored)
  status          TEXT NOT NULL DEFAULT 'awaiting_upload'
                  CHECK (status IN ('awaiting_upload', 'processing', 'ready', 'errored')),
  error_message   TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  asset_ready_at  TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_video_uploads_user ON public.pending_video_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_video_uploads_upload_id ON public.pending_video_uploads(mux_upload_id);
CREATE INDEX IF NOT EXISTS idx_pending_video_uploads_asset_id ON public.pending_video_uploads(mux_asset_id) WHERE mux_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_video_uploads_post ON public.pending_video_uploads(post_id) WHERE post_id IS NOT NULL;

ALTER TABLE public.pending_video_uploads ENABLE ROW LEVEL SECURITY;

-- A user can see and manipulate only their own pending uploads. Webhook
-- writes use the service role (DataSource) and bypass RLS.
DROP POLICY IF EXISTS "pending_video_uploads: own rows" ON public.pending_video_uploads;
CREATE POLICY "pending_video_uploads: own rows"
  ON public.pending_video_uploads FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Defensive: add the story FK only if the stories table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stories') THEN
    BEGIN
      ALTER TABLE public.pending_video_uploads
        ADD CONSTRAINT pending_video_uploads_story_id_fkey
        FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- Crop rect on the post (and story, if present) so playback can render it
-- without a server-side re-encode. Shape: { x, y, width, height,
-- aspectRatio? } — all normalized.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS video_crop_rect JSONB NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stories') THEN
    EXECUTE 'ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS video_crop_rect JSONB NULL';
  END IF;
END $$;
