-- Migration 0002: Cross-machine project state.
--
-- One row per project_slug. The active state of any major build (current phase,
-- pending tasks, locked decisions, schema notes) is queryable from any machine
-- via Supabase Studio without needing the chat transcript or a git pull.
--
-- Read it with:
--   SELECT * FROM project_memory WHERE project_slug = 'lead-pipeline';
--
-- Applied to production via Supabase MCP `apply_migration` on 2026-04-27.

CREATE TABLE IF NOT EXISTS project_memory (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_slug    text NOT NULL,
  title           text NOT NULL,
  current_phase   text NOT NULL,
  state           jsonb NOT NULL DEFAULT '{}'::jsonb,
  markdown        text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_slug)
);

CREATE INDEX IF NOT EXISTS idx_project_memory_org_slug ON project_memory (organization_id, project_slug);

-- Auto-update updated_at on any change
CREATE OR REPLACE FUNCTION touch_project_memory_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_memory_touch ON project_memory;
CREATE TRIGGER trg_project_memory_touch
  BEFORE UPDATE ON project_memory
  FOR EACH ROW EXECUTE FUNCTION touch_project_memory_updated_at();
