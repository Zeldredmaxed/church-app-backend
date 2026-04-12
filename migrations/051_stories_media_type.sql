ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS media_type TEXT
  CHECK (media_type IN ('image', 'video'));
