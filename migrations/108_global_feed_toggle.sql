-- 108: Global feed toggle — user pref + tenant kill-switch + enterprise gate
--
-- Today the social feed is implicitly global (no tenant filter on
-- public.posts queries). This locks it down to "your church only"
-- by default and adds opt-in for cross-church viewing.
--
-- Three layers gate visibility:
--   1. users.show_global_feed   — user pref (default false = my church only)
--   2. tenants.allow_cross_tenant_feed — owner kill-switch (default true)
--   3. tier check               — feature gated to enterprise tier
--
-- Effective access = (user_pref) AND (tenant_allows) AND (tier=enterprise).
-- If any layer is false, the feed filters to user's current tenant.
--
-- Shorts/trending already work this way at the controller layer
-- (separate /trending and /my-church routes). This brings the feed
-- to parity via a user pref instead of two routes.

-- USER-LEVEL: opt-in cross-church viewing. Default false so a member
-- on a tenant that flips between tiers doesn't suddenly see (or stop
-- seeing) external content without an explicit toggle.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS show_global_feed BOOLEAN NOT NULL DEFAULT false;

-- TENANT-LEVEL: owner kill-switch. Default true (feature available
-- to all enterprise tenants unless the owner explicitly disables).
-- Non-enterprise tenants ignore this value because the tier check
-- short-circuits earlier in the resolver.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS allow_cross_tenant_feed BOOLEAN NOT NULL DEFAULT true;

-- No new indexes — the column is read once per feed query and used
-- in a CASE inside the WHERE clause, not as a filter key. The
-- existing feed query's index on (created_at DESC) carries the load.
