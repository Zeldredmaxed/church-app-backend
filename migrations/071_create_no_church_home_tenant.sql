-- 071: Seed the single No Church Home tenant
--
-- Every user who signs up without picking a real church is parked here so
-- the rest of the app's tenant-required code paths still resolve. The
-- partial unique index from migration 070 enforces uniqueness — this
-- migration is idempotent because the INSERT uses ON CONFLICT DO NOTHING
-- against the index.
--
-- Mobile shows this row at the top of the church chooser as "No Church
-- Home" (or however the frontend wants to label it). Joining real churches
-- later moves the user out of this tenant via the
-- /api/memberships/me/switch-church endpoint.

INSERT INTO public.tenants (id, name, slug, tier, is_guest)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'No Church Home',
  'no-church-home',
  'standard',
  true
)
ON CONFLICT DO NOTHING;
