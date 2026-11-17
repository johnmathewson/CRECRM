-- 0040 — Calendar events from John's personal Google Calendar (the connected
-- account that isn't the business inbox),
-- read-only (calendar.readonly scope on the existing Google connection).
--
-- Only events that match the CRM are stored: an attendee who is a known
-- contact, or a title/location that names a property with an open deal.
-- Everything else on the calendar (personal events) is never written.
--
-- Past matched events are logged once to the deal's timeline (activities,
-- type meeting/tour/call). The nightly deal check-in reads both past and
-- upcoming events, and Steward's morning brief lists today's.
--
-- Applied via Supabase MCP on 2026-11-17 one statement at a time; end
-- state is this file.

CREATE TABLE IF NOT EXISTS calendar_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  account          text NOT NULL,              -- Google account the event came from
  external_id      text NOT NULL,              -- Google event id (instance id for recurring)
  status           text NOT NULL DEFAULT 'confirmed',
  title            text,
  location         text,
  description      text,                       -- first 500 chars
  start_at         timestamptz NOT NULL,
  end_at           timestamptz,
  all_day          boolean NOT NULL DEFAULT false,
  attendees        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{email, name, response}]
  contact_ids      uuid[] NOT NULL DEFAULT '{}',
  property_id      uuid REFERENCES properties(id) ON DELETE SET NULL,
  deal_id          uuid REFERENCES deals(id) ON DELETE SET NULL,
  match_reason     text,
  activity_id      uuid REFERENCES activities(id) ON DELETE SET NULL,
  html_link        text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account, external_id)
);

CREATE INDEX IF NOT EXISTS calendar_events_deal_idx ON calendar_events (deal_id, start_at);
CREATE INDEX IF NOT EXISTS calendar_events_start_idx ON calendar_events (organization_id, start_at);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Written by the service role (nightly sync), read by John's session.
DROP POLICY IF EXISTS calendar_events_authenticated_all ON calendar_events;
CREATE POLICY calendar_events_authenticated_all ON calendar_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- gmail_oauth_tokens.scopes now records what Google actually granted (not
-- what we asked for), so the CRM can tell whether Calendar was approved.
