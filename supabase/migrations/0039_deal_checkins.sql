-- 0039 — Nightly deal check-in.
--
-- Every night at 8:45 PM Central a deal agent reads each open deal (fields,
-- stage history, recent emails/texts with its people and property, John's
-- earlier check-in answers), writes its read of the deal, and picks the
-- deals worth one question from John tonight. John answers with a tap or a
-- sentence; the answer is logged to the deal's timeline (activities) and the
-- agent proposes field changes he accepts with one tap. The agent never
-- changes a deal or messages anyone on its own.
--
-- Applied via Supabase MCP on 2026-11-11 one statement at a time (the MCP
-- times out on multi-statement DDL); end state is this file.

-- next_step / next_step_due are John's (set when he accepts a suggestion or
-- edits the deal). The agent's nightly read lives in the agent_* columns,
-- so it never overwrites what John decided.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step        text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_step_due    date;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS agent_summary    text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS agent_next_step  text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS agent_risk       text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS agent_summary_at timestamptz;

-- One check-in per night.
CREATE TABLE IF NOT EXISTS deal_checkins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  checkin_date     date NOT NULL,                 -- America/Chicago date
  created_at       timestamptz NOT NULL DEFAULT now(),
  deals_reviewed   integer NOT NULL DEFAULT 0,
  notified_at      timestamptz,
  notify_error     text,
  model_used       text,
  tokens_input     integer,
  tokens_output    integer,
  error_log        jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (organization_id, checkin_date)
);

-- One question per deal picked for the night.
CREATE TABLE IF NOT EXISTS deal_checkin_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  checkin_id         uuid NOT NULL REFERENCES deal_checkins(id) ON DELETE CASCADE,
  deal_id            uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  rank               integer NOT NULL,
  why_now            text,
  status_summary     text,
  question           text NOT NULL,
  quick_answers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What John said
  answered_at        timestamptz,
  answer_choice      text,
  answer_text        text,
  activity_id        uuid REFERENCES activities(id) ON DELETE SET NULL,
  -- What the agent proposed from the answer, and what John accepted
  suggested_changes  jsonb,
  applied_changes    jsonb,
  applied_at         timestamptz,
  skipped_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkin_id, deal_id)
);

CREATE INDEX IF NOT EXISTS deal_checkin_items_deal_idx ON deal_checkin_items (deal_id, created_at DESC);

ALTER TABLE deal_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_checkin_items ENABLE ROW LEVEL SECURITY;

-- Written by the nightly job (service role), read and answered by John's
-- logged-in session. No anon access.
DROP POLICY IF EXISTS deal_checkins_authenticated_all ON deal_checkins;
CREATE POLICY deal_checkins_authenticated_all ON deal_checkins
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS deal_checkin_items_authenticated_all ON deal_checkin_items;
CREATE POLICY deal_checkin_items_authenticated_all ON deal_checkin_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
