-- Migration 054: SECURITY DEFINER function for atomic direct-channel creation.
--
-- Background: the RLS WITH CHECK policy on channel_members runs an EXISTS
-- subquery against chat_channels, which itself goes through chat_channels
-- SELECT RLS. For a freshly-INSERTed direct channel, this creates a
-- bootstrap problem we've patched twice (migration 045, migration 053)
-- but is still failing in production with 42501 — the policy chain is
-- fragile in ways the standalone reproductions don't surface.
--
-- This function takes the whole "create-or-fetch a direct DM channel"
-- operation off the RLS path. SECURITY DEFINER runs as the function owner
-- (postgres) so it bypasses RLS entirely; the function performs its own
-- authorization checks reading auth.jwt() — same identity the caller has.
--
-- Usage from the service:
--   const [channel] = await queryRunner.query(
--     `SELECT * FROM public.create_direct_channel($1)`,
--     [participantId],
--   );

CREATE OR REPLACE FUNCTION public.create_direct_channel(p_participant_id UUID)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_tenant_id UUID;
  v_channel   public.chat_channels;
BEGIN
  v_user_id   := (auth.jwt() ->> 'sub')::uuid;
  v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'current_tenant_id')::uuid;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth.jwt() sub is null — caller is not authenticated';
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no current_tenant_id in JWT — call POST /api/auth/switch-tenant first';
  END IF;
  IF v_user_id = p_participant_id THEN
    RAISE EXCEPTION 'cannot create a direct channel with yourself';
  END IF;

  -- Both users must belong to the same tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = v_user_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'caller is not a member of tenant %', v_tenant_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = p_participant_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'participant is not a member of tenant %', v_tenant_id;
  END IF;

  -- Return existing direct channel between the two users if one exists
  SELECT ch.* INTO v_channel
  FROM public.chat_channels ch
  JOIN public.channel_members cm1 ON cm1.channel_id = ch.id AND cm1.user_id = v_user_id
  JOIN public.channel_members cm2 ON cm2.channel_id = ch.id AND cm2.user_id = p_participant_id
  WHERE ch.tenant_id = v_tenant_id AND ch.type = 'direct'
  LIMIT 1;

  IF v_channel.id IS NOT NULL THEN
    RETURN v_channel;
  END IF;

  -- Create the channel
  INSERT INTO public.chat_channels (tenant_id, name, type, created_by)
  VALUES (v_tenant_id, NULL, 'direct', v_user_id)
  RETURNING * INTO v_channel;

  -- Add both members
  INSERT INTO public.channel_members (channel_id, user_id) VALUES
    (v_channel.id, v_user_id),
    (v_channel.id, p_participant_id);

  RETURN v_channel;
END;
$$;

-- Allow authenticated users to call the function. SECURITY DEFINER means
-- the function body runs as the owner regardless of the caller's role,
-- but EXECUTE permission still gates who can invoke it.
REVOKE ALL ON FUNCTION public.create_direct_channel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_direct_channel(UUID) TO authenticated;
