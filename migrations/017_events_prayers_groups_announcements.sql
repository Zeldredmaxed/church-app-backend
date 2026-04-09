-- =============================================================================
-- Migration 017: Events, Prayer Requests, Groups, Announcements,
--                Sermons, Volunteer, Check-In, Gallery, Moderation,
--                Recurring Giving, Tenant Profile
--
-- Adds all tables needed for the 12 new frontend features.
-- =============================================================================

BEGIN;

-- ============================================================================
-- EVENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  location        TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id  UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('going', 'interested', 'not_going')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_start ON public.events (tenant_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON public.event_rsvps (event_id, status);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events: select within tenant" ON public.events;
CREATE POLICY "events: select within tenant" ON public.events
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "event_rsvps: select within tenant" ON public.event_rsvps;
CREATE POLICY "event_rsvps: select within tenant" ON public.event_rsvps
  FOR SELECT USING (
    event_id IN (SELECT id FROM public.events WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

DROP POLICY IF EXISTS "event_rsvps: insert own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: insert own" ON public.event_rsvps
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "event_rsvps: update own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: update own" ON public.event_rsvps
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "event_rsvps: delete own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: delete own" ON public.event_rsvps
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub')::uuid);


-- ============================================================================
-- PRAYER REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.prayers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  is_anonymous  BOOLEAN NOT NULL DEFAULT false,
  is_answered   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prayer_prays (
  prayer_id  UUID NOT NULL REFERENCES public.prayers(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (prayer_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_prayers_tenant_created ON public.prayers (tenant_id, created_at DESC);

ALTER TABLE public.prayers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prayers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prayer_prays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prayer_prays FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prayers: select within tenant" ON public.prayers;
CREATE POLICY "prayers: select within tenant" ON public.prayers
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "prayer_prays: select within tenant" ON public.prayer_prays;
CREATE POLICY "prayer_prays: select within tenant" ON public.prayer_prays
  FOR SELECT USING (
    prayer_id IN (SELECT id FROM public.prayers WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

DROP POLICY IF EXISTS "prayer_prays: insert own" ON public.prayer_prays;
CREATE POLICY "prayer_prays: insert own" ON public.prayer_prays
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "prayer_prays: delete own" ON public.prayer_prays;
CREATE POLICY "prayer_prays: delete own" ON public.prayer_prays
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub')::uuid);


-- ============================================================================
-- GROUPS / MINISTRIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  created_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id   UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groups_tenant ON public.groups (tenant_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON public.group_messages (group_id, created_at DESC);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups: select within tenant" ON public.groups;
CREATE POLICY "groups: select within tenant" ON public.groups
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "group_members: select within tenant" ON public.group_members;
CREATE POLICY "group_members: select within tenant" ON public.group_members
  FOR SELECT USING (
    group_id IN (SELECT id FROM public.groups WHERE tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid)
  );

DROP POLICY IF EXISTS "group_members: insert own" ON public.group_members;
CREATE POLICY "group_members: insert own" ON public.group_members
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "group_members: delete own" ON public.group_members;
CREATE POLICY "group_members: delete own" ON public.group_members
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "group_messages: select for members" ON public.group_messages;
CREATE POLICY "group_messages: select for members" ON public.group_messages
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM public.group_members WHERE user_id = (auth.jwt() ->> 'sub')::uuid)
  );

DROP POLICY IF EXISTS "group_messages: insert for members" ON public.group_messages;
CREATE POLICY "group_messages: insert for members" ON public.group_messages
  FOR INSERT WITH CHECK (
    author_id = (auth.jwt() ->> 'sub')::uuid
    AND group_id IN (SELECT group_id FROM public.group_members WHERE user_id = (auth.jwt() ->> 'sub')::uuid)
  );


-- ============================================================================
-- ANNOUNCEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'general'
              CHECK (priority IN ('urgent', 'important', 'general')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_tenant_created ON public.announcements (tenant_id, created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements: select within tenant" ON public.announcements;
CREATE POLICY "announcements: select within tenant" ON public.announcements
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );


-- ============================================================================
-- SERMONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sermons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  speaker        TEXT NOT NULL,
  audio_url      TEXT,
  video_url      TEXT,
  thumbnail_url  TEXT,
  duration       INTEGER,  -- seconds
  series_name    TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sermons_tenant_created ON public.sermons (tenant_id, created_at DESC);

ALTER TABLE public.sermons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sermons: select within tenant" ON public.sermons;
CREATE POLICY "sermons: select within tenant" ON public.sermons
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );


-- ============================================================================
-- VOLUNTEER OPPORTUNITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.volunteer_opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role_name       TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  schedule        TEXT NOT NULL DEFAULT '',
  spots_available INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.volunteer_signups (
  opportunity_id UUID NOT NULL REFERENCES public.volunteer_opportunities(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, user_id)
);

ALTER TABLE public.volunteer_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_opportunities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_signups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "volunteer_opportunities: select within tenant" ON public.volunteer_opportunities;
CREATE POLICY "volunteer_opportunities: select within tenant" ON public.volunteer_opportunities
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "volunteer_signups: select own" ON public.volunteer_signups;
CREATE POLICY "volunteer_signups: select own" ON public.volunteer_signups
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "volunteer_signups: insert own" ON public.volunteer_signups;
CREATE POLICY "volunteer_signups: insert own" ON public.volunteer_signups
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "volunteer_signups: delete own" ON public.volunteer_signups;
CREATE POLICY "volunteer_signups: delete own" ON public.volunteer_signups
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub')::uuid);


-- ============================================================================
-- SERVICES (for check-in)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time  TIME NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.check_ins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES public.services(id) ON DELETE SET NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_ins_tenant_date ON public.check_ins (tenant_id, checked_in_at DESC);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services FORCE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services: select within tenant" ON public.services;
CREATE POLICY "services: select within tenant" ON public.services
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

DROP POLICY IF EXISTS "check_ins: insert own" ON public.check_ins;
CREATE POLICY "check_ins: insert own" ON public.check_ins
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub')::uuid);

DROP POLICY IF EXISTS "check_ins: select own" ON public.check_ins;
CREATE POLICY "check_ins: select own" ON public.check_ins
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);


-- ============================================================================
-- PHOTO GALLERY
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gallery_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  media_url   TEXT NOT NULL,
  album       TEXT NOT NULL DEFAULT 'general',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_tenant_album ON public.gallery_photos (tenant_id, album, created_at DESC);

ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_photos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery: select within tenant" ON public.gallery_photos;
CREATE POLICY "gallery: select within tenant" ON public.gallery_photos
  FOR SELECT USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );


-- ============================================================================
-- CONTENT MODERATION (post reports)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.post_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  post_id       UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  reported_by   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'reviewed', 'removed')),
  reviewed_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_reports_tenant_status ON public.post_reports (tenant_id, status, created_at DESC);

ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reports FORCE ROW LEVEL SECURITY;

-- Only admins/service role can read reports
-- INSERT is allowed for any authenticated tenant member via service role


-- ============================================================================
-- RECURRING GIVING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recurring_gifts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount                  DECIMAL(10,2) NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'usd',
  frequency               TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  fund_name               TEXT,
  stripe_subscription_id  TEXT UNIQUE,
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_gifts_user ON public.recurring_gifts (user_id, status);

ALTER TABLE public.recurring_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_gifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_gifts: select own" ON public.recurring_gifts;
CREATE POLICY "recurring_gifts: select own" ON public.recurring_gifts
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub')::uuid);


-- ============================================================================
-- TENANT PROFILE (extend tenants)
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS service_times TEXT,  -- JSON string or plain text
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

COMMIT;
