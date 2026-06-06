-- 082: Admin dashboard gap-fill schema
--
-- groups.type: discriminator the Discipleship + Small Groups tabs filter by
--   ('small_group' | 'discipleship' | 'ministry' | 'class' | 'other')
--
-- check_ins.event_id: lets bulk check-in + visitor add attach to an
--   Event (one-off) instead of forcing a Service (recurring). The
--   dashboard's Events page Check-In tab needed this.
--
-- Public iCal token: per-tenant random token so external calendars
--   (Google/Apple/Outlook) can subscribe without bearer auth.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'small_group'
    CONSTRAINT groups_type_chk CHECK (type IN (
      'small_group', 'discipleship', 'ministry', 'class', 'other'
    ));

CREATE INDEX IF NOT EXISTS idx_groups_tenant_type
  ON public.groups (tenant_id, type);

-- event_id can coexist with service_id (e.g. an event scheduled inside a
-- recurring service slot). Either-or is fine; both is fine; neither = a
-- generic "I was at church" check-in.
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS event_id UUID NULL REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_check_ins_event
  ON public.check_ins (event_id) WHERE event_id IS NOT NULL;

-- Per-tenant iCal subscription token. Generated lazily on first
-- request — admin can rotate via /tenants/:id/ical/regenerate-token.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ical_token TEXT NULL UNIQUE;

-- Prayer-answered timestamp so the Care KPI "answered this month"
-- has a real signal. Existing answered rows get a fallback to
-- created_at (best we can do without history).
ALTER TABLE public.prayers
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ NULL;

UPDATE public.prayers SET answered_at = created_at
WHERE is_answered = true AND answered_at IS NULL;
