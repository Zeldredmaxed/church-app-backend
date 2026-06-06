-- 097: Tag-bound groups (auto-membership)
--
-- A pastor binds a tag to a group ("Men's Ministry" tag → "Men's
-- Ministry" group). When a member is tagged, they're auto-added to
-- the group. When the tag is removed, they're auto-removed — but
-- ONLY if they joined via the tag, not if they were manually added.
--
-- 1:1 binding: one tag per group, one group per tag (per tenant).
-- Splitting one tag across multiple groups would create ambiguous
-- removal semantics ("which group should they leave when the tag
-- goes away?"). One-to-one is the natural mental model for ministry
-- teams and scales to any number of (tag, group) pairs.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS auto_tag_id UUID NULL
    REFERENCES public.tags(id) ON DELETE SET NULL;

-- One group per tag — enforces the 1:1 invariant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_auto_tag
  ON public.groups (auto_tag_id) WHERE auto_tag_id IS NOT NULL;

-- Provenance: how did this user end up in this group?
--   NULL  → manually added (creator, join-request approval, admin add)
--   UUID  → auto-added because they hold this tag
-- Removing the tag auto-removes the row iff added_via_tag_id matches.
-- A user who was BOTH manually added AND holds the tag stays added
-- because their row's added_via_tag_id is NULL (manual takes
-- precedence at insert time via the ON CONFLICT DO NOTHING in the
-- service-layer sync).
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS added_via_tag_id UUID NULL
    REFERENCES public.tags(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_added_via_tag
  ON public.group_members (added_via_tag_id)
  WHERE added_via_tag_id IS NOT NULL;
