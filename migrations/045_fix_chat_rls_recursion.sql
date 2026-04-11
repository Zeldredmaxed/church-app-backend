-- Migration 045: Fix RLS infinite recursion on channel_members + chat_messages
-- Bug: policies used `cm2.channel_id = cm2.channel_id` (self-comparison, always true)
-- Fix: use SECURITY DEFINER helper function to check membership without triggering RLS

-- 1. Create a helper function that checks channel membership WITHOUT going through RLS
-- (SECURITY DEFINER runs as the function owner, bypassing RLS on the table)
CREATE OR REPLACE FUNCTION public.is_channel_member(p_channel_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id AND user_id = p_user_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Fix channel_members SELECT policy
DROP POLICY IF EXISTS "channel_members: select visible" ON public.channel_members;
CREATE POLICY "channel_members: select visible"
  ON public.channel_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_members.channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR public.is_channel_member(ch.id, (auth.jwt() ->> 'sub')::uuid)
        )
    )
  );

-- 3. Fix channel_members INSERT policy
DROP POLICY IF EXISTS "channel_members: insert member" ON public.channel_members;
CREATE POLICY "channel_members: insert member"
  ON public.channel_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = channel_members.channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          -- Public channels: user can add themselves
          (ch.type = 'public' AND channel_members.user_id = (auth.jwt() ->> 'sub')::uuid)
          -- Direct channels: creator can add, or existing member can add
          OR (ch.type = 'direct' AND (
            ch.created_by = (auth.jwt() ->> 'sub')::uuid
            OR public.is_channel_member(ch.id, (auth.jwt() ->> 'sub')::uuid)
          ))
          -- Private channels: admin/pastor only
          OR (ch.type = 'private' AND EXISTS (
            SELECT 1 FROM public.tenant_memberships tm
            WHERE tm.user_id = (auth.jwt() ->> 'sub')::uuid
              AND tm.tenant_id = ch.tenant_id
              AND tm.role IN ('admin', 'pastor')
          ))
        )
    )
  );

-- 4. Fix chat_channels SELECT policy (also had the self-reference bug in its EXISTS)
DROP POLICY IF EXISTS "chat_channels: select accessible" ON public.chat_channels;
CREATE POLICY "chat_channels: select accessible"
  ON public.chat_channels FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      type = 'public'
      OR public.is_channel_member(id, (auth.jwt() ->> 'sub')::uuid)
    )
  );

-- 5. Fix chat_messages SELECT policy
DROP POLICY IF EXISTS "chat_messages: select in accessible channel" ON public.chat_messages;
CREATE POLICY "chat_messages: select in accessible channel"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_messages.channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR public.is_channel_member(ch.id, (auth.jwt() ->> 'sub')::uuid)
        )
    )
  );

-- 6. Fix chat_messages INSERT policy
DROP POLICY IF EXISTS "chat_messages: insert in accessible channel" ON public.chat_messages;
CREATE POLICY "chat_messages: insert in accessible channel"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')::uuid
    AND EXISTS (
      SELECT 1 FROM public.chat_channels ch
      WHERE ch.id = chat_messages.channel_id
        AND ch.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
        AND (
          ch.type = 'public'
          OR public.is_channel_member(ch.id, (auth.jwt() ->> 'sub')::uuid)
        )
    )
  );

-- 7. Fix member_badges — add INSERT policy for service-role operations
-- The BadgesService runs auto-check in service role context, so we allow
-- inserts where tenant_id matches the current tenant.
DROP POLICY IF EXISTS "member_badges: insert within tenant" ON public.member_badges;
CREATE POLICY "member_badges: insert within tenant"
  ON public.member_badges FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );

-- Also add UPDATE and DELETE for badge management
DROP POLICY IF EXISTS "member_badges: manage within tenant" ON public.member_badges;
CREATE POLICY "member_badges: manage within tenant"
  ON public.member_badges FOR ALL
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
  );
