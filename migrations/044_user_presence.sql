-- Migration 044: User Presence (Online Status + Last Seen)
-- Tracks online/offline status and last activity timestamp for DM presence indicators.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_online    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();

-- Also add a last_read_at column to channel_members for accurate unread counts
ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT now();
