-- Migration 058: Add gender column to public.users.
--
-- Mobile UI accepts: 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'
-- CHECK constraint enforces the same allow-list at the DB layer.
-- Nullable — existing users keep NULL until they set it.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IS NULL OR gender IN ('female', 'male', 'non_binary', 'prefer_not_to_say'));
