-- Merge the 8 pre-catalog platform badges into the global pool.
-- They were seeded with is_system = false (per-tenant) before the 246-badge
-- catalog existed. Frontend's /badges/global filter is is_system = true.
-- Flipping the flag makes them globally visible without touching IDs — so
-- existing member_badges earnings (32 rows across 7 of the 8) stay valid.
UPDATE public.badges
SET is_system = true
WHERE is_system = false
  AND name IN (
    'First Steps',
    'Faithful Attender',
    'Prayer Warrior',
    'Generous Giver',
    'Baptized',
    'Community Builder',
    'Servant Heart',
    'Social Butterfly'
  );
