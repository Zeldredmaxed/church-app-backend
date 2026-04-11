-- Migration 043: Performance Indexes for Dashboard Speed
-- Addresses missing indexes causing full table scans on dashboard-critical queries.

-- 1. tenant_memberships: date filtering for "new this month" KPI
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_created
  ON public.tenant_memberships (tenant_id, created_at DESC);

-- 2. prayers: answered status filtering for pending prayers KPI
CREATE INDEX IF NOT EXISTS idx_prayers_tenant_answered
  ON public.prayers (tenant_id, is_answered);

-- 3. volunteer_signups: NO indexes existed at all — critical for volunteer KPIs
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_opportunity
  ON public.volunteer_signups (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_volunteer_signups_user
  ON public.volunteer_signups (user_id);

-- 4. users: created_at filtering for member KPIs
CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON public.users (created_at DESC);

-- 5. group_members: engagement query joins
CREATE INDEX IF NOT EXISTS idx_group_members_user
  ON public.group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_joined
  ON public.group_members (group_id, joined_at DESC);

-- 6. posts: author_id for engagement scoring
CREATE INDEX IF NOT EXISTS idx_posts_author_tenant_created
  ON public.posts (author_id, tenant_id, created_at DESC);

-- 7. comments: author_id for engagement scoring
CREATE INDEX IF NOT EXISTS idx_comments_author_tenant_created
  ON public.comments (author_id, tenant_id, created_at DESC);

-- 8. fundraiser_donations: donor lookups for tax statements
CREATE INDEX IF NOT EXISTS idx_fdonations_tenant_donor
  ON public.fundraiser_donations (tenant_id, donor_id);
