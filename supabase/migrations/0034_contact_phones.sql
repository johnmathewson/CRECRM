-- One person, many numbers. The contact's primary phone stays on contacts.phone;
-- any OTHER number they have reached us from (a lead's sender_phone that differs,
-- a second cell, an office line) is kept here instead of being discarded or
-- overwriting the primary. 176 leads carried a number different from their
-- contact's at the time of the Oct 2026 repair; this is where those live.
--
-- Applied via Supabase MCP on 2026-10-13 as part of the record-integrity repair.
CREATE TABLE IF NOT EXISTS contact_phones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone           text NOT NULL CHECK (phone ~ '^\+[1-9]\d{9,14}$'),
  label           text,
  source          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_contact_phones_phone ON contact_phones (organization_id, phone);
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_phones_anon_all ON contact_phones;
CREATE POLICY contact_phones_anon_all ON contact_phones FOR ALL TO anon USING (true) WITH CHECK (true);
COMMENT ON TABLE contact_phones IS 'Additional phone numbers per contact (E.164). Primary stays on contacts.phone. Never discard a number a person reached us from.';
