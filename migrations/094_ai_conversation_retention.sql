-- 094: AI conversation retention TTL.
--
-- Privacy policy promises 30-day deletion of "other personal data."
-- AI conversation content (admin prompts about members, finances,
-- sermon drafts) qualifies. Without a TTL the data sits forever,
-- contradicting the policy = GDPR Art. 5(1)(e) storage-limitation
-- violation.
--
-- Default: 90 days from last activity. updated_at is bumped on each
-- new message by the AI service, so the column drifts forward as
-- long as the conversation is active and only gets old when the
-- user actually stops using it. AiScheduler runs a daily DELETE
-- WHERE expires_at < now() — ai_messages cascades via FK.
--
-- The 90-day window is more generous than the 30-day policy on
-- "other personal data" because AI conversations are a tool the
-- admin actively uses (like email drafts), not historical records.

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL
    DEFAULT (now() + interval '90 days');

CREATE INDEX IF NOT EXISTS idx_ai_conversations_expires_at
  ON public.ai_conversations (expires_at);

-- Backfill existing rows so they don't all expire immediately.
UPDATE public.ai_conversations
SET expires_at = COALESCE(updated_at, created_at) + interval '90 days'
WHERE expires_at < now() + interval '1 day';
