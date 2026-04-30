-- Migration 0005: Agent activity log.
--
-- Each meaningful step in a lead's lifecycle gets an event row. This is
-- what powers the /agent dashboard ("here's what your AI employee did
-- today") and the /inbox/[id] activity timeline.
--
-- Granularity choice: one row per action, not one per state. Lets us
-- show counts, durations, and side-by-side actor (agent vs. user)
-- without joining across multiple state transitions.

CREATE TABLE IF NOT EXISTS lead_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  -- Common event_type values:
  --   received | qualified | matched_property | unmatched
  --   spam_flagged | draft_generated | draft_edited
  --   sent | archived | promoted_to_deal | error
  actor           text NOT NULL CHECK (actor IN ('agent','user','system')),
  summary         text,                 -- human-readable one-liner
  metadata        jsonb DEFAULT '{}',   -- { confidence, match_score, model, tokens, error_msg, ... }
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead       ON lead_events (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_org_time   ON lead_events (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_type_time  ON lead_events (event_type, occurred_at DESC);

COMMENT ON TABLE  lead_events            IS 'Append-only activity log for the inbound-lead agent. Powers /agent dashboard.';
COMMENT ON COLUMN lead_events.event_type IS 'received|qualified|matched_property|unmatched|spam_flagged|draft_generated|draft_edited|sent|archived|promoted_to_deal|error';
COMMENT ON COLUMN lead_events.actor      IS 'Who/what produced this event: agent (LLM), user (John), system (cron, webhook)';
COMMENT ON COLUMN lead_events.metadata   IS 'Free-form jsonb. Keys depend on event_type. See app code for shape.';
