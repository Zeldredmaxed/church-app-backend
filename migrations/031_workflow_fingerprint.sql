BEGIN;

-- Structural fingerprint for duplicate detection in the marketplace.
-- This is a hash of the node types + connection graph, ignoring names,
-- positions, and config values. Two workflows with identical structure
-- produce the same fingerprint.
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS structure_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_fingerprint
  ON public.workflow_templates (structure_fingerprint)
  WHERE structure_fingerprint IS NOT NULL AND is_published = true;

COMMENT ON COLUMN public.workflow_templates.structure_fingerprint IS
  'SHA-256 of the canonical node-type sequence + connection graph. '
  'Used to detect duplicate workflows in the marketplace.';

COMMIT;
