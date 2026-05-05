-- 0013_crexi_leads_state.sql
--
-- Per-(property × lead) state cache for the CREXi leads watcher.
--
-- The watcher (Chrome extension on a 30-min alarm) opens the seller-side
-- /property/<id>/dashboard/leads page in a hidden tab, reads the lead
-- table, and decides which rows to "deep-scrape" (click to expand the
-- side panel and read email + activity timeline). To make that decision
-- it diffs the live page against this table — only rows whose
-- listing_activity status advanced or whose visit count rose get clicked.
--
-- Identity: CREXi exposes no stable lead ID in the DOM. We key on
-- (property_id, lower(name), lower(email or '')); name+email is unique
-- enough that collisions essentially never happen.
--
-- Once a CREXi lead resolves to a CRM contact (by matching email or
-- phone), we store the contact_id + lead_id linkage so subsequent
-- engagement signals append onto the right lead's lead_events feed.

CREATE TABLE IF NOT EXISTS crexi_leads_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_id uuid not null references properties(id) on delete cascade,
  crexi_listing_id text not null,
  -- Lead identity (from CREXi DOM; CREXi has no stable ID exposed)
  name text not null,
  email text,
  phone text,
  -- Latest state from CREXi
  company text,
  role text,
  level_of_interest text,         -- "Executed CA" / "Opened OM" / "Visited Page" / etc.
  number_of_visits int,
  last_activity_date timestamptz,
  -- Lead linkage to CRM (resolved on first contact match)
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  -- Polling metadata
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  last_panel_scrape_at timestamptz,  -- last time we clicked into details
  raw_panel jsonb,                   -- last full payload from the side panel
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crexi_leads_state_property_identity_idx
  ON crexi_leads_state (property_id, lower(name), lower(coalesce(email, '')));

CREATE INDEX IF NOT EXISTS crexi_leads_state_property_idx ON crexi_leads_state(property_id);
CREATE INDEX IF NOT EXISTS crexi_leads_state_lead_idx ON crexi_leads_state(lead_id);
CREATE INDEX IF NOT EXISTS crexi_leads_state_email_idx ON crexi_leads_state(lower(email));

CREATE OR REPLACE FUNCTION set_updated_at_crexi_leads_state()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crexi_leads_state_updated_at ON crexi_leads_state;
CREATE TRIGGER crexi_leads_state_updated_at
  BEFORE UPDATE ON crexi_leads_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_crexi_leads_state();

COMMENT ON TABLE crexi_leads_state IS
  'Diff cache for the CREXi leads watcher (Chrome extension, 30-min alarm). Each row = one lead seen on one listing dashboard. The watcher only deep-scrapes rows whose level_of_interest advanced or number_of_visits rose since last poll.';
