-- Migration 041: Chat Media & Voice Note Support
-- Adds media_url and media_type columns to chat_messages.
-- content becomes nullable (media-only messages allowed).

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS media_url  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) DEFAULT NULL;

-- Allow content to be null (media-only messages)
ALTER TABLE public.chat_messages
  ALTER COLUMN content DROP NOT NULL;
