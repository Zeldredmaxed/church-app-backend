-- 079: Index hygiene
--
-- Drops redundant single-column indexes on post_likes / post_saves —
-- both tables have a composite PK that already starts with post_id, so
-- the standalone post_id index is dead weight on every INSERT.
--
-- Adds chat_messages(user_id) — badge SUM(COUNT WHERE user_id=$1) for
-- the message_count auto-award rule currently seq-scans the table.

DROP INDEX IF EXISTS public.idx_post_likes_post_id;
DROP INDEX IF EXISTS public.idx_post_saves_post_id;

CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON public.chat_messages (user_id);

-- Audit log filter convenience: actor_role + summary search.
-- Already had (tenant_id, created_at DESC) — add a partial trigram-ish
-- index on summary for ILIKE'%foo%' searches. Without pg_trgm available
-- we just create a btree on (tenant_id, action) which speeds the most
-- common filter combo.
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_action
  ON public.admin_audit_log (tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_role
  ON public.admin_audit_log (tenant_id, actor_role, created_at DESC);
