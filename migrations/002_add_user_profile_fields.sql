-- =============================================================================
-- MIGRATION: 002_add_user_profile_fields.sql
-- Phase 1, Week 2 — Add profile fields to public.users
--
-- Adds full_name and avatar_url to public.users so PATCH /users/me
-- has columns to write to. These were omitted from 001 to keep the initial
-- migration focused on the security foundation.
--
-- No RLS changes required — the existing UPDATE policy
-- "users: update self only" already covers any columns on this table.
-- =============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS full_name  TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.users.full_name  IS 'Display name set by the user via PATCH /api/users/me.';
COMMENT ON COLUMN public.users.avatar_url IS 'URL of the user''s profile picture (S3/CDN path).';

-- =============================================================================
-- VERIFICATION
-- Run after applying to confirm the columns exist.
-- =============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'users'
--   AND column_name  IN ('full_name', 'avatar_url');
--
-- Expected: 2 rows, data_type = 'text', is_nullable = 'YES'

COMMIT;
