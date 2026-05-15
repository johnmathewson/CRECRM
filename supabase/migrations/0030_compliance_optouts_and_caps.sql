-- 0030_compliance_optouts_and_caps.sql
--
-- CAN-SPAM compliance + send-rate safety nets.
--
-- Adds:
--   email_optouts          — anyone who unsubscribed, never email again
--   broker_voice_profile.physical_address   — required by CAN-SPAM for the email footer
--   broker_voice_profile.unsubscribe_email  — where opt-out replies should go
--   broker_voice_profile.daily_send_cap     — org-wide ceiling on outbound emails per day

CREATE TABLE IF NOT EXISTS email_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  email text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_optouts_unique_idx
  ON email_optouts (organization_id, lower(email));

CREATE INDEX IF NOT EXISTS email_optouts_lookup_idx
  ON email_optouts (organization_id, unsubscribed_at DESC);

COMMENT ON TABLE email_optouts IS
  'CAN-SPAM opt-out list. Every outbound send MUST filter recipients against this table. Lower-cased email is the canonical key.';

ALTER TABLE broker_voice_profile
  ADD COLUMN IF NOT EXISTS physical_address text,
  ADD COLUMN IF NOT EXISTS unsubscribe_email text,
  ADD COLUMN IF NOT EXISTS daily_send_cap integer NOT NULL DEFAULT 100;

UPDATE broker_voice_profile
SET
  physical_address = COALESCE(physical_address, '[TODO: set your physical address — required by CAN-SPAM]'),
  unsubscribe_email = COALESCE(unsubscribe_email, 'inquiries@stewardshipcre.com'),
  daily_send_cap = COALESCE(daily_send_cap, 100)
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';
