-- Migration 0007: Extend CHECK constraints for the inbound-lead pipeline.
--
-- The existing leads.source / leads.status / communications.channel
-- constraints predate the inbox build and reject the values the agent
-- needs to write (email/sms/voice sources, reviewing/unmatched/spam
-- statuses, voice/website channels). Loosen them.
--
-- Applied to production via Supabase MCP before being committed.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (
  source = ANY (ARRAY[
    'website', 'referral', 'cold_call', 'walk_in', 'costar', 'other', 'valuation_agent',
    -- Inbox pipeline:
    'email', 'sms', 'voice', 'phone', 'manual_test', 'crexi', 'loopnet'
  ])
);

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status = ANY (ARRAY[
    'new', 'contacted', 'qualified', 'unqualified', 'converted', 'dead',
    -- Inbox pipeline:
    'reviewing', 'unmatched', 'spam', 'archived', 'promoted', 'sent'
  ])
);

ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_channel_check;
ALTER TABLE communications ADD CONSTRAINT communications_channel_check CHECK (
  channel = ANY (ARRAY[
    'email', 'calendar', 'sms', 'phone',
    -- Inbox pipeline:
    'voice', 'website', 'manual_test'
  ])
);
