-- 0035 — The record enforces itself.
--
-- Oct 2026 integrity audit: 15 write paths, each with its own identity logic,
-- and a database that enforced only two unique indexes. Everything else was
-- nullable, so messages landed under nobody, phones were stored five ways,
-- and the same person+property accumulated sibling leads. The writers now go
-- through src/lib/cre-os/record-touch.ts (resolveParty + recordTouch); this
-- migration makes the DB refuse what that module never produces.
--
-- Preconditions verified before applying (all zero): comms without a person
-- (excl. internal), comms without external_id, leads without a person (excl.
-- spam/archived/unmatched), duplicate open leads per contact+property, phones
-- not E.164, emails not lowercase.
--
-- Applied via Supabase MCP on 2026-10-13.

-- ── Normalizers: fix formats on the way in, so a real lead is never lost to
--    a stray dash. Unparseable phones are moved to notes, never silently
--    dropped and never rejected. ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_phone_e164(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN p ~ '^\+[1-9]\d{9,14}$' THEN p
    WHEN length(regexp_replace(p, '\D', '', 'g')) = 10 THEN '+1' || regexp_replace(p, '\D', '', 'g')
    WHEN length(regexp_replace(p, '\D', '', 'g')) = 11 AND left(regexp_replace(p, '\D', '', 'g'), 1) = '1'
      THEN '+' || regexp_replace(p, '\D', '', 'g')
    WHEN p ~ '^\+' AND length(regexp_replace(p, '\D', '', 'g')) BETWEEN 10 AND 15
      THEN '+' || regexp_replace(p, '\D', '', 'g')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION contacts_normalize_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
  NEW.email := nullif(lower(trim(NEW.email)), '');
  IF NEW.phone IS NOT NULL THEN
    n := normalize_phone_e164(NEW.phone);
    IF n IS NULL AND trim(NEW.phone) <> '' THEN
      NEW.notes := concat_ws(E'\n', NEW.notes, '[unparsed phone: ' || trim(NEW.phone) || ']');
    END IF;
    NEW.phone := n;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_normalize_identity ON contacts;
CREATE TRIGGER trg_contacts_normalize_identity
  BEFORE INSERT OR UPDATE OF email, phone ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_normalize_identity();

CREATE OR REPLACE FUNCTION leads_normalize_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
  NEW.sender_email := nullif(lower(trim(NEW.sender_email)), '');
  IF NEW.sender_phone IS NOT NULL THEN
    n := normalize_phone_e164(NEW.sender_phone);
    IF n IS NULL AND trim(NEW.sender_phone) <> '' THEN
      NEW.notes := concat_ws(E'\n', NEW.notes, '[unparsed phone: ' || trim(NEW.sender_phone) || ']');
    END IF;
    NEW.sender_phone := n;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_normalize_identity ON leads;
CREATE TRIGGER trg_leads_normalize_identity
  BEFORE INSERT OR UPDATE OF sender_email, sender_phone ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_normalize_identity();

-- One-time: the 3 lead emails still carrying uppercase.
UPDATE leads SET sender_email = lower(trim(sender_email))
 WHERE sender_email IS NOT NULL AND sender_email <> lower(trim(sender_email));

-- ── contacts ──────────────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD CONSTRAINT contacts_phone_e164_chk CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{9,14}$'),
  ADD CONSTRAINT contacts_email_lower_chk CHECK (email IS NULL OR email = lower(trim(email)));

-- ── leads ─────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD CONSTRAINT leads_phone_e164_chk CHECK (sender_phone IS NULL OR sender_phone ~ '^\+[1-9]\d{9,14}$'),
  ADD CONSTRAINT leads_email_lower_chk CHECK (sender_email IS NULL OR sender_email = lower(trim(sender_email))),
  -- Every lead has its person. The only rows allowed without one are the
  -- ones that are not a conversation: spam, archived history, and 'unmatched'
  -- (an inbound whose sender could not be identified — alarmed, never silent).
  -- coalesce: a NULL on the right side would make the whole CHECK NULL,
  -- which Postgres treats as a pass.
  ADD CONSTRAINT leads_contact_required_chk CHECK (
    contact_id IS NOT NULL OR coalesce(status, '') IN ('spam', 'archived', 'unmatched')
  );

-- ONE open lead per person per property. Repeat inquiries thread into it
-- (intake, questionnaire, crexi-report all look this up first and handle the
-- 23505 race by threading). Closed statuses are free to accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_open_contact_property
  ON leads (organization_id, contact_id, property_id)
  WHERE contact_id IS NOT NULL
    AND property_id IS NOT NULL
    AND status NOT IN ('archived', 'spam', 'converted', 'promoted', 'dead');

-- ── communications ────────────────────────────────────────────────────────
ALTER TABLE communications
  ALTER COLUMN external_id SET NOT NULL,
  -- Every message has a person on the other end. 'internal' (Steward briefs
  -- to John, self-tests) is the one kind that legitimately has none.
  -- coalesce is load-bearing: touch_kind is NULL on inbound rows, and
  -- `NULL OR false` is NULL, which a CHECK accepts. The smoke test caught it.
  ADD CONSTRAINT communications_contact_required_chk CHECK (
    contact_id IS NOT NULL OR coalesce(touch_kind, '') = 'internal'
  );

-- 'manual_test' was a dev artifact; 'website' stays (the public form is a
-- real human channel). Engagement signals (CREXi views/downloads) do not
-- belong in this table at all — they live in activities / crexi_leads_state.
ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_channel_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_channel_check CHECK (
    channel IN ('email', 'calendar', 'sms', 'phone', 'voice', 'website')
  );

-- Dead writers' statuses/sources retired from the vocab.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_source_check CHECK (
    source IN ('website', 'referral', 'cold_call', 'walk_in', 'costar', 'other',
               'valuation_agent', 'email', 'sms', 'voice', 'phone', 'crexi', 'loopnet')
  );

COMMENT ON CONSTRAINT communications_contact_required_chk ON communications IS
  'Every message has a person (contact_id) unless touch_kind=internal. Write through src/lib/cre-os/record-touch.ts.';
COMMENT ON INDEX uq_leads_open_contact_property IS
  'One open lead per contact+property. Writers look up first and thread repeats; the 23505 on a race is caught and threaded.';
