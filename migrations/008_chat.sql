-- ============================================================================
-- Migration 008: Chat System (Channels, Members, Messages)
-- ============================================================================
-- Prerequisite: 007_follows_and_global_posts.sql applied
--
-- Creates:
--   S SECTION 1 -- chat_channels table
--   S SECTION 2 -- chat_channels RLS policies
--   S SECTION 3 -- channel_members table
--   S SECTION 4 -- channel_members RLS policies
--   S SECTION 5 -- chat_messages table
--   S SECTION 6 -- chat_messages RLS policies
--   S SECTION 7 -- Performance indexes
--   S SECTION 8 -- Verification queries
-- ============================================================================

-- ============================================================================
-- S SECTION 1 -- chat_channels table
-- ============================================================================
-- Channels are tenant-scoped: all chat happens within a church community.
-- Types: 'public' (visible to all tenant members), 'private' (invite-only),
-- 'direct' (1:1 messaging between two users).

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT,
  type        TEXT NOT NULL CHECK (type IN ('public', 'private', 'direct')),
  created_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_channels IS
  'Tenant-scoped chat channels. '
  'public = visible to all tenant members. '
  'private = invite-only. '
  'direct = 1:1 messaging between two users.';

-- Reuse the set_updated_at trigger function from migration 003
DROP TRIGGER IF EXISTS trg_chat_channels_updated_at ON public.chat_channels;
CREATE TRIGGER trg_chat_channels_updated_at
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- S SECTION 2 -- chat_channels RLS (enable only — policies deferred until
--                after channel_members table exists, see Section 3b)
-- ============================================================================

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channels FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- S SECTION 3 -- channel_members table
-- ============================================================================
-- Tracks which users belong to which channels.
-- For public channels, membership is implicit (all tenant members have access),
-- but explicit membership is used for private and direct channels.
-- Public channel members are tracked here too for notification targeting.

CREATE TABLE IF NOT EXISTS public.channel_members (
  channel_id  UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (channel_id, user_id)
);

COMMENT ON TABLE public.channel_members IS
  'Channel membership. Required for private/direct channels. '
  'Also used for public channels to track who joined (for notification targeting).';

-- ============================================================================
-- S SECTION 4 -- channel_members RLS policies
-- ============================================================================

ALTER TABLE public.channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_members FORCE ROW LEVEL SECURITY;

-- SELECT: A user can see memberships for channels they have access to.
-- This is scoped by joining to chat_channels to enforce tenant isolation.
DROP POLICY IF EXISTS "channel_members: select visible" ON public.channel_members;
CREATE POLICY "channel_members: select visible"
  ON public.channel_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR EXISTS (
            SELECT 1 FROM public.channel_members cm2
            WHERE cm2.channel_id = channel_id
              AND cm2.user_id = (auth.jwt() ->> 'sub')::uuid
          )
        )
    )
  );

-- INSERT: Admin/pastor can add members to private channels.
-- For direct channels, either participant can add the other.
-- For public channels, any tenant member can join (add themselves).
DROP POLICY IF EXISTS "channel_members: insert member" ON public.channel_members;
CREATE POLICY "channel_members: insert member"
  ON public.channel_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          -- Public channels: user can add themselves
          (ch.type = 'public' AND user_id = (auth.jwt() ->> 'sub')::uuid)
          OR
          -- Direct channels: either participant can add the other
          (ch.type = 'direct' AND EXISTS (
            SELECT 1 FROM public.channel_members cm2
            WHERE cm2.channel_id = channel_id
              AND cm2.user_id = (auth.jwt() ->> 'sub')::uuid
          ))
          OR
          -- Direct channels: creator can add the first member (themselves + other)
          (ch.type = 'direct' AND ch.created_by = (auth.jwt() ->> 'sub')::uuid)
          OR
          -- Private channels: admin/pastor can add members
          (ch.type = 'private' AND EXISTS (
            SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
              AND tm.tenant_id = ch.tenant_id
              AND tm.role IN ('admin', 'pastor')
          ))
        )
    )
  );

-- DELETE: A user can remove themselves (leave). Admin can remove others from private.
DROP POLICY IF EXISTS "channel_members: delete member" ON public.channel_members;
CREATE POLICY "channel_members: delete member"
  ON public.channel_members
  FOR DELETE
  USING (
    -- User can always leave (remove themselves)
    user_id = (auth.jwt() ->> 'sub')::uuid
    OR
    -- Admin/pastor can remove members from private channels
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      JOIN public.tenant_memberships tm
        ON tm.tenant_id = ch.tenant_id
        AND tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.role IN ('admin', 'pastor')
      WHERE ch.id = channel_id AND ch.type = 'private'
    )
  );

-- ============================================================================
-- S SECTION 3b -- chat_channels RLS policies (deferred — channel_members exists now)
-- ============================================================================

-- SELECT: Tenant members can see public channels in their tenant.
-- For private/direct channels, user must be a member of the channel.
DROP POLICY IF EXISTS "chat_channels: select accessible" ON public.chat_channels;
CREATE POLICY "chat_channels: select accessible"
  ON public.chat_channels
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      type = 'public'
      OR EXISTS (
        SELECT 1 FROM public.channel_members cm
        WHERE cm.channel_id = id AND cm.user_id = (auth.jwt() ->> 'sub')::uuid
      )
    )
  );

-- INSERT: Tenant admins/pastors can create public/private channels.
-- Any tenant member can create direct channels.
-- The created_by must match the authenticated user.
DROP POLICY IF EXISTS "chat_channels: insert by member" ON public.chat_channels;
CREATE POLICY "chat_channels: insert by member"
  ON public.chat_channels
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND created_by = (auth.jwt() ->> 'sub')::uuid
    AND (
      type = 'direct'
      OR
      EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
          AND tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
          AND tm.role IN ('admin', 'pastor')
      )
    )
  );

-- UPDATE: Only tenant admins/pastors can update public/private channels.
DROP POLICY IF EXISTS "chat_channels: update by admin" ON public.chat_channels;
CREATE POLICY "chat_channels: update by admin"
  ON public.chat_channels
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND type != 'direct'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.role IN ('admin', 'pastor')
    )
  );

-- DELETE: Only tenant admins can delete public/private channels.
DROP POLICY IF EXISTS "chat_channels: delete by admin" ON public.chat_channels;
CREATE POLICY "chat_channels: delete by admin"
  ON public.chat_channels
  FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND type != 'direct'
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
        AND tm.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND tm.role = 'admin'
    )
  );

-- ============================================================================
-- S SECTION 5 -- chat_messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_messages IS
  'Chat messages within channels. Tenant isolation is enforced '
  'by joining to chat_channels in the RLS policy.';

-- ============================================================================
-- S SECTION 6 -- chat_messages RLS policies
-- ============================================================================

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;

-- SELECT: A user can see messages in channels they have access to.
-- Public channels: any tenant member. Private/direct: must be a channel member.
DROP POLICY IF EXISTS "chat_messages: select in accessible channel" ON public.chat_messages;
CREATE POLICY "chat_messages: select in accessible channel"
  ON public.chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR EXISTS (
            SELECT 1 FROM public.channel_members cm
            WHERE cm.channel_id = channel_id
              AND cm.user_id = (auth.jwt() ->> 'sub')::uuid
          )
        )
    )
  );

-- INSERT: A user can send messages to channels they are a member of.
-- For public channels, any tenant member can post.
-- user_id must match the authenticated user (no impersonation).
DROP POLICY IF EXISTS "chat_messages: insert in accessible channel" ON public.chat_messages;
CREATE POLICY "chat_messages: insert in accessible channel"
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')::uuid
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR EXISTS (
            SELECT 1 FROM public.channel_members cm
            WHERE cm.channel_id = channel_id
              AND cm.user_id = (auth.jwt() ->> 'sub')::uuid
          )
        )
    )
  );

-- No UPDATE or DELETE policies — messages are immutable once sent.
-- Future: add soft-delete or edit-within-window if needed.

-- ============================================================================
-- S SECTION 7 -- Performance indexes
-- ============================================================================

-- Query: list channels for a tenant (channel list screen)
CREATE INDEX IF NOT EXISTS idx_chat_channels_tenant
  ON public.chat_channels (tenant_id, type, created_at DESC);

-- Query: find channel memberships for a user (my channels)
CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON public.channel_members (user_id, channel_id);

-- Query: list members of a channel
CREATE INDEX IF NOT EXISTS idx_channel_members_channel
  ON public.channel_members (channel_id, user_id);

-- Query: messages in a channel, newest first (chat scroll)
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON public.chat_messages (channel_id, created_at DESC);

-- Query: messages by user (moderation, user profile)
CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON public.chat_messages (user_id, created_at DESC);

-- ============================================================================
-- S SECTION 8 -- Verification queries
-- ============================================================================

-- 8a: chat_channels table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'chat_channels'
-- ORDER BY ordinal_position;

-- 8b: channel_members table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'channel_members'
-- ORDER BY ordinal_position;

-- 8c: chat_messages table exists with expected columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'chat_messages'
-- ORDER BY ordinal_position;

-- 8d: RLS enabled on all three tables
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename IN ('chat_channels', 'channel_members', 'chat_messages');
-- Expected: all three have rowsecurity = true

-- 8e: RLS policies on chat_channels (expect 4: SELECT, INSERT, UPDATE, DELETE)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'chat_channels'
-- ORDER BY policyname;

-- 8f: RLS policies on channel_members (expect 3: SELECT, INSERT, DELETE)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'channel_members'
-- ORDER BY policyname;

-- 8g: RLS policies on chat_messages (expect 2: SELECT, INSERT)
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'chat_messages'
-- ORDER BY policyname;

-- 8h: Type constraint on chat_channels
-- INSERT INTO public.chat_channels (tenant_id, name, type, created_by)
-- VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'invalid_type', '00000000-0000-0000-0000-000000000001');
-- Expected: ERROR — violates check constraint

-- 8i: Indexes exist
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename IN ('chat_channels', 'channel_members', 'chat_messages')
-- ORDER BY indexname;
