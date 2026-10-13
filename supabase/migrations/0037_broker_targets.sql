-- 0037 — broker_targets: the annual commission number the Pipeline
-- scoreboard measures against (closed YTD + weighted in-flight vs goal).
-- One row per org per year; edited inline on /cre-os/pipeline.
--
-- Applied via Supabase MCP on 2026-10-13.
CREATE TABLE IF NOT EXISTS broker_targets (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  year            integer NOT NULL,
  commission_goal numeric NOT NULL CHECK (commission_goal >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, year)
);
ALTER TABLE broker_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broker_targets_anon_all ON broker_targets;
CREATE POLICY broker_targets_anon_all ON broker_targets FOR ALL TO anon USING (true) WITH CHECK (true);
COMMENT ON TABLE broker_targets IS 'Annual commission goal per org. The Pipeline scoreboard measures closed + weighted in-flight commission against it.';
