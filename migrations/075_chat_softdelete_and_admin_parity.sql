-- 075: Chat soft-delete + group_messages soft-delete + transactions refund tracking
--
-- Soft-delete on chat_messages and group_messages so an admin can
-- moderate a reported message while preserving forensic context
-- (deleted_by, deleted_at) and the original payload. Feed/render
-- queries should filter deleted_at IS NULL.
--
-- transactions.refund_status: lets admins see refund state without
-- round-tripping to Stripe. Refunded amount can be partial (refund
-- created for less than the donation).

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_active
  ON public.chat_messages (channel_id, created_at DESC)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='group_messages') THEN
    EXECUTE 'ALTER TABLE public.group_messages
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS deleted_reason TEXT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_group_messages_active
      ON public.group_messages (group_id, created_at DESC)
      WHERE deleted_at IS NULL';
  END IF;
END $$;

-- ─── Donation refund tracking ─────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS refund_status TEXT NULL
    CONSTRAINT transactions_refund_status_chk
    CHECK (refund_status IS NULL OR refund_status IN ('none','partial','full','pending','failed')),
  ADD COLUMN IF NOT EXISTS refunded_amount BIGINT NULL,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT NULL;
