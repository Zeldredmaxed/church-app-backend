-- Migration 048: Platform-Wide Badge System (250 badges)
-- Adds is_system and rarity_tier columns, then seeds 250 platform badges.

-- 1. Schema changes
ALTER TABLE public.badges
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rarity_tier TEXT DEFAULT 'common';

-- 2. Mark existing 8 badges as system badges
UPDATE public.badges SET is_system = true WHERE name IN (
  'First Steps', 'Faithful Attender', 'Prayer Warrior', 'Generous Giver',
  'Baptized', 'Community Builder', 'Servant Heart', 'Social Butterfly'
);
