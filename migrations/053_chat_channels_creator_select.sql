-- Migration 053: Allow channel creators to SELECT their own chat_channels row
-- before any members have been added.
--
-- Bug: getOrCreateConversation 500s when creating a new direct channel.
-- The flow is (1) INSERT chat_channels, (2) INSERT both channel_members rows.
--
-- Step 2 fails because the channel_members INSERT policy WITH CHECK runs
--   EXISTS (SELECT 1 FROM chat_channels ch WHERE ch.id = channel_members.channel_id ...)
-- which is subject to the chat_channels SELECT policy. That policy required
-- (type = 'public' OR is_channel_member(id, sub)). For a just-created direct
-- channel, the caller is not yet a member — so SELECT returns 0 rows, the
-- EXISTS is false, and the channel_members WITH CHECK rejects the row.
--
-- Fix: let the row's creator SELECT the channel. The caller already had to
-- pass the chat_channels INSERT WITH CHECK (created_by = sub), so allowing
-- them to SELECT what they just created does not widen visibility — it just
-- breaks the bootstrap deadlock.

DROP POLICY IF EXISTS "chat_channels: select accessible" ON public.chat_channels;
CREATE POLICY "chat_channels: select accessible"
  ON public.chat_channels FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid
    AND (
      type = 'public'
      OR created_by = (auth.jwt() ->> 'sub')::uuid
      OR public.is_channel_member(id, (auth.jwt() ->> 'sub')::uuid)
    )
  );
