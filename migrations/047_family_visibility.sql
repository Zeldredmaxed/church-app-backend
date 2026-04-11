-- Migration 047: Family Tree Visibility (Public/Private toggle)

CREATE TABLE IF NOT EXISTS public.family_visibility (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.family_visibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_visibility: read all"
  ON public.family_visibility FOR SELECT
  USING (true);

CREATE POLICY "family_visibility: manage own"
  ON public.family_visibility FOR ALL
  USING (user_id = auth.uid());
