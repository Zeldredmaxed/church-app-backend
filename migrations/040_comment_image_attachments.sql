-- Migration 040: Comment Image Attachments
-- Adds media_url column to comments table for image attachments.
-- content becomes nullable (image-only comments allowed).

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL;

-- Allow content to be null (image-only comments)
ALTER TABLE public.comments
  ALTER COLUMN content DROP NOT NULL;
